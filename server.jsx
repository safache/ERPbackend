const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const Employee = require('./models/employee');
const Supplier = require('./models/supplier');
const Client = require('./models/client');
const Product = require('./models/product');
const { pool }  = require('./config/db'); // Import pool here
const Absence = require('./models/Absence');
const PurchaseOrder = require('./models/PurchaseOrder');
const ClientOrder = require('./models/ClientOrder');
const DashboardModel = require('./models/Dashboard');
require('dotenv').config();

const app = express();

// Configure multer for image upload
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({ storage: storage });

// Create uploads directory if it doesn't exist
const fs = require('fs');
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// Environment variables
const PORT = process.env.PORT || 5000;


///////////////////////////////////////////////////////user//////////////////////////////////////////////////////////////////////////


app.post('/login', async (req, res) => {
  try {
    const { email, mdp } = req.body;

    const employee = await Employee.authenticate(email, mdp);
    
    if (!employee) {
      return res.status(401).json({ 
        error: 'Authentication failed', 
        message: 'Invalid email or password' 
      });
    }

    res.json(employee);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

// Middleware pour protéger les routes
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ msg: 'No token provided' });

  const jwt = require('jsonwebtoken');
  jwt.verify(token, process.env.JWT_SECRET || 'your-secure-jwt-secret-key', (err, user) => {
    if (err) return res.status(403).json({ msg: 'Invalid token: ' + err.message });
    req.user = user;
    next();
  });
};

/////////////////////////////////////////////////////////////////Dashboard//////////////////////////////////////////////////////////
app.get('/api/user', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id; // Assuming the JWT payload includes the user's ID
    const result = await pool.query(`
      SELECT e.*, r.name AS role_name, r.permissions
      FROM public.employees e
      LEFT JOIN public.roles r ON e.role_id = r.id
      WHERE e.id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

app.get('/dashboard', authenticateToken, async (req, res) => {
  try {
  
    const dashboardData = await DashboardModel.getDashboardStats();
    
       res.json(dashboardData);
  } catch (error) {
    console.error('Detailed dashboard route error:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    
    res.status(500).json({ 
      error: 'Failed to fetch dashboard data',
      details: error.message 
    });
  }
});

////////////////////////////////////////////////////////////////quote/////////////////////////////////////////////////////////

// Update quote status
app.put('/quotes/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    await pool.query(`
      UPDATE quotes SET status = $1 WHERE id = $2
    `, [status, id]);
    
    res.json({ message: 'Quote status updated successfully' });
  } catch (error) {
    console.error('Error updating quote status:', error);
    res.status(500).json({ error: 'Failed to update quote status' });
  }
});

// Delete quote
app.delete('/quotes/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM quotes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Quote deleted successfully' });
  } catch (error) {
    console.error('Error deleting quote:', error);
    res.status(500).json({ error: 'Failed to delete quote' });
  }
});



// Get quote with details for download
app.get('/quotes/:id', authenticateToken, async (req, res) => {
  try {
    // Get quote details with client info
    const quoteResult = await pool.query(`
      SELECT 
        q.*,
        CAST(q.total_amount AS DECIMAL(10,2)) as total_amount,
        q.quote_number,
        c.first_name || ' ' || c.last_name as client_name,
        c.email as client_email,
        c.company as client_company,
        c.address as client_address,
        c.phone as client_phone
      FROM quotes q
      JOIN clients c ON q.client_id = c.id
      WHERE q.id = $1
    `, [req.params.id]);

    if (quoteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const quote = quoteResult.rows[0];

    // Get quote items with product details
    const itemsResult = await pool.query(`
      SELECT 
        qi.*,
        p.name as product_name,
        p.description as product_description,
        CAST(qi.unit_price AS DECIMAL(10,2)) as unit_price,
        CAST(qi.total_price AS DECIMAL(10,2)) as total_price
      FROM quote_items qi
      JOIN products p ON qi.product_id = p.id
      WHERE qi.quote_id = $1
      ORDER BY p.name
    `, [req.params.id]);

    // Format the response
    quote.items = itemsResult.rows.map(item => ({
      ...item,
      unit_price: parseFloat(item.unit_price),
      total_price: parseFloat(item.total_price)
    }));

    res.json(quote);
  } catch (error) {
    console.error('Error fetching quote details:', error);
    res.status(500).json({ error: 'Failed to fetch quote details' });
  }
});

// Create a new quote
app.post('/api/quotes', authenticateToken, async (req, res) => {
  try {
    const { clientId, items } = req.body;
    const result = await pool.query(
      `INSERT INTO quotes (client_id, status, created_at, valid_until)
       VALUES ($1, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days')
       RETURNING id`,
      [clientId]
    );

    const quoteId = result.rows[0].id;

    // Insert quote items
    for (const item of items) {
      await pool.query(
        `INSERT INTO quote_items (quote_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [quoteId, item.productId, item.quantity, item.price]
      );
    }

    res.json({ message: 'Quote created successfully', quoteId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create quote' });
  }
});

// Get all quotes
app.get('/api/quotes', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        q.*,
        CAST(q.total_amount AS DECIMAL(10,2)) as total_amount,
        q.quote_number,
        c.first_name || ' ' || c.last_name as client_name,
        c.company as client_company,
        c.email as client_email
      FROM quotes q
      JOIN clients c ON q.client_id = c.id
      ORDER BY q.created_at DESC
    `);

    // Format the response
    const quotes = result.rows.map(quote => ({
      ...quote,
      total_amount: parseFloat(quote.total_amount) || 0,
      created_at: new Date(quote.created_at).toISOString(),
      valid_until: new Date(quote.valid_until).toISOString()
    }));

    res.json(quotes);
  } catch (error) {
    console.error('Error fetching quotes:', error);
    res.status(500).json({ 
      error: 'Failed to fetch quotes',
      details: error.message 
    });
  }
});
// Update a quote
app.put('/api/quotes/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); // Start a transaction

    const { id } = req.params;
    const { clientId, validUntil, notes, items } = req.body;

    // Validate required fields
    if (!clientId || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'clientId and items are required, and items must be an array' });
    }

    // Update the quotes table
    const updateQuoteQuery = `
      UPDATE quotes
      SET client_id = $1,
          valid_until = $2,
          notes = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *;
    `;
    const quoteValues = [clientId, validUntil || null, notes || null, id];
    const quoteResult = await client.query(updateQuoteQuery, quoteValues);

    if (quoteResult.rows.length === 0) {
      throw new Error('Quote not found');
    }

    // Delete existing quote_items for this quote
    const deleteItemsQuery = `
      DELETE FROM quote_items
      WHERE quote_id = $1;
    `;
    await client.query(deleteItemsQuery, [id]);

    // Insert new quote_items
    for (const item of items) {
      const { productId, quantity, price } = item;

      // Validate item fields
      if (!productId || !quantity || !price) {
        throw new Error('Each item must have productId, quantity, and price');
      }

      const insertItemQuery = `
        INSERT INTO quote_items (quote_id, product_id, quantity, unit_price)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
      `;
      const itemValues = [id, productId, quantity, price];
      await client.query(insertItemQuery, itemValues);
    }

    // Commit the transaction
    await client.query('COMMIT');

    // Fetch the updated quote with client details and items
    const updatedQuoteQuery = `
      SELECT 
        q.*,
        CAST(q.total_amount AS DECIMAL(10,2)) as total_amount,
        q.quote_number,
        c.first_name || ' ' || c.last_name as client_name,
        c.company as client_company,
        c.email as client_email
      FROM quotes q
      JOIN clients c ON q.client_id = c.id
      WHERE q.id = $1;
    `;
    const updatedQuoteResult = await client.query(updatedQuoteQuery, [id]);
    const updatedQuote = updatedQuoteResult.rows[0];

    // Fetch the updated quote items
    const itemsQuery = `
      SELECT 
        qi.*,
        p.name as product_name,
        p.description as product_description,
        CAST(qi.unit_price AS DECIMAL(10,2)) as unit_price,
        CAST(qi.total_price AS DECIMAL(10,2)) as total_price
      FROM quote_items qi
      JOIN products p ON qi.product_id = p.id
      WHERE qi.quote_id = $1
      ORDER BY p.name;
    `;
    const itemsResult = await client.query(itemsQuery, [id]);
    updatedQuote.items = itemsResult.rows.map(item => ({
      ...item,
      unit_price: parseFloat(item.unit_price),
      total_price: parseFloat(item.total_price)
    }));

    res.json(updatedQuote);
  } catch (error) {
    await client.query('ROLLBACK'); // Rollback on error
    console.error('Error updating quote:', error);
    res.status(500).json({ error: 'Failed to update quote', details: error.message });
  } finally {
    client.release();
  }
});
////////////////////////////////////////////////////////////////Notification//////////////////////////////////////////////////////////

// Get notifications for a user
// Backend endpoint (in your server code)
app.get('/api/notifications/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await pool.query(`
      SELECT *
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [userId]);

    const formattedNotifications = result.rows.map(notification => ({
      id: notification.id,
      message: notification.message,
      read: notification.read,
      created_at: notification.created_at,
      type: notification.type
    }));

    res.json(formattedNotifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Get the count of unread notifications for a user
app.get('/api/notifications/unread-count/:userId', authenticateToken, async (req, res) => {
    const userId = req.params.userId;

    try {
        // Verify that the authenticated user matches the requested user
        if (req.user.id !== userId) {
            return res.status(403).json({ message: 'Unauthorized access' });
        }

        const result = await pool.query(
            `SELECT COUNT(*) as unread_count
             FROM notifications
             WHERE user_id = $1 AND read = FALSE`,
            [userId]
        );

        res.json({ unreadCount: parseInt(result.rows[0].unread_count) });
    } catch (error) {
        console.error('Error fetching unread notification count:', error);
        res.status(500).json({ message: 'Error fetching unread notification count' });
    }
});

// Mark all notifications as read for a user
app.put('/api/notifications/:userId/mark-all-read', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Update all unread notifications for the user
    await pool.query(
      `UPDATE notifications 
       SET read = true 
       WHERE user_id = $1 AND read = false`,
      [userId]
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ 
      error: 'Failed to mark notifications as read',
      details: error.message 
    });
  }
});
app.delete('/:userId/delete-all', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Delete all notifications for the user
    const result = await pool.query(
      'DELETE FROM notifications WHERE user_id = $1',
      [userId]
    );

    res.json({ 
      status: 'success', 
      message: 'All notifications deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting notifications:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to delete notifications' 
    });
  }
});

/////////////////////////////////////////////////////////////// sales facture  //////////////////////////////////////////////////////////

app.get('/api/withholding-taxes', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
     SELECT wt.*, si.invoicenumber as invoice_number,
         c.first_name || ' ' || c.last_name as client_name,
         c.address as client_address
  FROM sales_invoice_withholding_tax wt
  JOIN salesinvoices si ON wt.sales_invoice_id = si.id
  JOIN clients c ON si.clientid = c.id
  ORDER BY wt.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching withholding taxes:', error);
    res.status(500).json({ message: 'Error fetching withholding taxes' });
  }
});


app.get('/api/sales-invoices', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT si.*, 
             c.first_name || ' ' || c.last_name as client_name 
      FROM salesinvoices si
      JOIN clients c ON si.clientid = c.id
      ORDER BY si.createdat DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ message: 'Error fetching invoices' });
  }
});

app.get('/api/sales-invoices/:id', authenticateToken, async (req, res) => {
  try {
    const [invoice, details, withholdingTax] = await Promise.all([
      pool.query(`
        SELECT si.*, 
               c.first_name || ' ' || c.last_name as client_name 
        FROM salesinvoices si
        JOIN clients c ON si.clientid = c.id
        WHERE si.id = $1
      `, [req.params.id]),
      pool.query(`
        SELECT sid.*, p.name as product_name
        FROM salesinvoicedetails sid
        JOIN products p ON sid.productid = p.id
        WHERE sid.salesinvoiceid = $1
      `, [req.params.id]),
      pool.query(`
        SELECT siwt.*
        FROM sales_invoice_withholding_tax siwt
        WHERE siwt.sales_invoice_id = $1
      `, [req.params.id])
    ]);

    res.json({
      invoice: invoice.rows[0],
      details: details.rows,
      withholding_tax: withholdingTax.rows[0] || null // Return null if no withholding tax record exists
    });
  } catch (error) {
    console.error('Error fetching invoice details:', error);
    res.status(500).json({ message: 'Error fetching invoice details' });
  }
});

app.put('/api/sales-invoices/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    const result = await pool.query(
      'UPDATE salesinvoices SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating invoice status:', error);
    res.status(500).json({ message: 'Error updating invoice status' });
  }
});

app.delete('/api/sales-invoices/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM salesinvoices WHERE id = $1', [req.params.id]);
    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ message: 'Error deleting invoice' });
  }
});



/////////////////////////////////////////////////////////////////    facture    ///////////////////////////////////////////////////////////




app.get('/api/purchase-invoices', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pi.*, s.name as supplier_name 
      FROM purchaseinvoices pi
      JOIN suppliers s ON pi.supplierid = s.id
      ORDER BY pi.createdat DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ message: 'Error fetching invoices' });
  }
});

app.get('/api/purchase-invoices/:id', authenticateToken, async (req, res) => {
  try {
    const [invoice, details] = await Promise.all([
      pool.query(`
        SELECT pi.*, s.name as supplier_name 
        FROM purchaseinvoices pi
        JOIN suppliers s ON pi.supplierid = s.id
        WHERE pi.id = $1
      `, [req.params.id]),
     pool.query(`
        SELECT pid.*, p.name as product_name
        FROM purchaseinvoicedetails pid
        JOIN products p ON pid.productid = p.id
        WHERE pid.purchaseinvoiceid = $1
      `, [req.params.id])
    ]);

    res.json({
      invoice: invoice.rows[0],
      details: details.rows
    });
  } catch (error) {
    console.error('Error fetching invoice details:', error);
    res.status(500).json({ message: 'Error fetching invoice details' });
  }
});

app.get('/api/purchase-invoices/:id/items', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        pid.id,
        pid.productid,
        pid.quantity,
        pid.unitprice,
        pid.totalprice,
        p.name as product_name,
        p.category
      FROM purchaseinvoicedetails pid
      JOIN products p ON pid.productid = p.id
      WHERE pid.purchaseinvoiceid = $1
      ORDER BY p.name
    `, [req.params.id]);

    

    const formattedItems = result.rows.map(item => {
      const formatted = {
        id: item.id,
        product_id: item.productid,
        product_name: item.product_name,
        category: item.category,
        quantity: parseInt(item.quantity) || 0,
        unitprice: parseFloat(item.unitprice) || 0,
        totalprice: parseFloat(item.totalprice) || 0
      };
    
      return formatted;
    });

    
    res.json(formattedItems);
  } catch (error) {
    console.error('Error fetching invoice items:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      error: 'Error fetching invoice items',
      details: error.message 
    });
  }
});



app.delete('/api/purchase-invoices/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM purchaseinvoices WHERE id = $1', [req.params.id]);
    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ message: 'Error deleting invoice' });
  }
});

// Add this new route to handle status updates
app.put('/api/purchase-invoices/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    const result = await pool.query(
      'UPDATE purchaseinvoices SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating invoice status:', error);
    res.status(500).json({ message: 'Error updating invoice status' });
  }
});
//////////////////////////////////////////////////////////////////orders///////////////////////////////////////////////////////////

// Get all purchase orders
app.get('/purchase-orders', authenticateToken, async (req, res) => {
  try {
    const purchaseOrders = await PurchaseOrder.getAll();
    res.json(purchaseOrders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new purchase order
app.post('/purchase-orders', authenticateToken, async (req, res) => {
  try {
    const { supplierId, products } = req.body;

    const supplier = await Supplier.getById(supplierId);
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });

    let totalAmount = 0;
    for (const item of products) {
      const product = await Product.getById(item.productId);
      if (!product) return res.status(404).json({ message: `Product ${item.productId} not found` });
      totalAmount += product.price * item.quantity;
    }

    const purchaseOrder = await PurchaseOrder.create(supplierId, totalAmount);

    for (const item of products) {
      const product = await Product.getById(item.productId);
      await PurchaseOrder.addOrderDetail(purchaseOrder.id, item.productId, item.quantity, product.price);
    }

    res.status(201).json(purchaseOrder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/purchase-orders/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updatedOrder = await PurchaseOrder.updateStatus(id, status);
    res.json(updatedOrder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// Get purchase order details with items
app.get('/purchase-orders/:id/items', authenticateToken, async (req, res) => {
  try {
    const items = await PurchaseOrder.getOrderItems(req.params.id);
    res.json(items);
  } catch (error) {
    console.error('Error fetching order items:', error);
    res.status(500).json({ message: 'Error fetching order items' });
  }
});

// Update purchase order
app.put('/purchase-orders/:id', authenticateToken, async (req, res) => {
  try {
    const { supplierId, items, totalAmount } = req.body;
    await PurchaseOrder.updateOrder(req.params.id, {
      supplierId,
      items,
      totalAmount
    });
    res.json({ message: 'Order updated successfully' });
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({ message: 'Error updating order' });
  }
});

// Delete purchase order
app.delete('/purchase-orders/:id', authenticateToken, async (req, res) => {
  try {
    await PurchaseOrder.deleteOrder(req.params.id);
    res.json({ message: 'Order deleted successfully' });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({ message: 'Error deleting order' });
  }
});

// Update order status
app.put('/purchase-orders/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query(
      'UPDATE purchase_orders SET status = $1 WHERE id = $2',
      [status, req.params.id]
    );
    res.json({ message: 'Status updated successfully' });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ message: 'Error updating status' });
  }
});



/////////////////////////////////////////////////////////////////////////////////client orders ////////////////////////////////////////
app.put('/client-orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { clientId, items, totalAmount } = req.body;
    
    await pool.query('BEGIN');
    
    // Update main order
    await pool.query(
      'UPDATE client_orders SET client_id = $1, total_amount = $2 WHERE id = $3',
      [clientId, totalAmount, id]
    );
    
    // Delete existing items
    await pool.query('DELETE FROM client_order_details WHERE client_order_id = $1', [id]);
    
    // Insert new items
    for (const item of items) {
      await pool.query(
        'INSERT INTO client_order_details (client_order_id, product_id, quantity, price_at_time) VALUES ($1, $2, $3, $4)',
        [id, item.productId, item.quantity, item.price]
      );
    }
    
    await pool.query('COMMIT');
    
    res.json({ message: 'Order updated successfully' });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error updating order:', error);
    res.status(500).json({ message: 'Error updating order' });
  }
});
// Get order items for a specific order
app.get('/client-orders/:id/items', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT coi.*, p.name as product_name 
       FROM client_order_details coi 
       JOIN products p ON p.id = coi.product_id 
       WHERE client_order_id= $1`,
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching order items:', error);
    res.status(500).json({ message: 'Error fetching order items' });
  }
});

app.post('/save-client-orders', authenticateToken, async (req, res) => {
  try {
    const { clientId, items, totalAmount } = req.body;
    
    await pool.query('BEGIN');

    // 1. Créer la commande
    const newOrder = await ClientOrder.create(clientId, totalAmount);

    // 2. Ajouter les détails de la commande
    for (const item of items) {
      await ClientOrder.addOrderDetail(
        newOrder.id, 
        item.productId, 
        item.quantity, 
        item.price
      );
    }
    await pool.query('COMMIT');

    res.status(201).json(newOrder);
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error creating order:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/client-orders/:id/details', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { productId, quantity, priceAtTime } = req.body;
    const orderDetail = await ClientOrder.addOrderDetail(id, productId, quantity, priceAtTime);
    res.status(201).json(orderDetail);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/client-orders/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const updatedOrder = await ClientOrder.updateStatus(id, status);
    res.json(updatedOrder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/client-orders', authenticateToken, async (req, res) => {
  try {
    const clientOrders = await ClientOrder.getAll();
    res.json(clientOrders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/client-orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const order = await ClientOrder.getById(id);
    if (!order) return res.status(404).json({ error: 'Client order not found' });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/client-orders/:id/details', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const details = await ClientOrder.getOrderDetails(id);
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Delete client order
app.delete('/client-orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // First delete the order items
    await pool.query(
      'DELETE FROM client_order_details WHERE client_order_id = $1',
      [id]
    );
    
    // Then delete the order itself
    const result = await pool.query(
      'DELETE FROM client_orders WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json({ message: 'Order deleted successfully' });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({ message: 'Error deleting order' });
  }
});

///////////////////////////////////////////////////////employe///////////////////////////////////////////////////////////////////////////////
// Endpoint to create or update a role for an employee
// Fetch all roles
app.get('/api/roles', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT id, name, description, permissions
      FROM public.roles
      ORDER BY name;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});
app.get('/roles', async (req, res) => {
  try {
    const roles = await pool.query('SELECT id, name FROM roles');
    res.json(roles);
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});
// Create or update a role
app.post('/api/roles', authenticateToken, async (req, res) => {
  try {
    const { name, description, permissions } = req.body;

    if (!name || !permissions) {
      return res.status(400).json({ error: 'Role name and permissions are required' });
    }

    const existingRole = await pool.query('SELECT * FROM roles WHERE name = $1', [name]);
    let role;

    if (existingRole.rows.length > 0) {
      const query = `
        UPDATE roles 
        SET description = $1, permissions = $2, updated_at = CURRENT_TIMESTAMP
        WHERE name = $3
        RETURNING *;
      `;
      const result = await pool.query(query, [description || null, permissions, name]);
      role = result.rows[0];
    } else {
      const query = `
        INSERT INTO roles (name, description, permissions, created_at, updated_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING *;
      `;
      const result = await pool.query(query, [name, description || null, permissions]);
      role = result.rows[0];
    }

    res.status(201).json(role);
  } catch (error) {
    console.error('Error creating/updating role:', error);
    res.status(500).json({ error: 'Failed to create/update role' });
  }
});

// Update an existing role
app.put('/api/roles/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, permissions } = req.body;

    if (!name || !permissions) {
      return res.status(400).json({ error: 'Role name and permissions are required' });
    }

    const query = `
      UPDATE roles 
      SET name = $1, description = $2, permissions = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *;
    `;
    const result = await pool.query(query, [name, description || null, permissions, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating role:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// Assign a role to an employee
app.post('/api/assign-role', authenticateToken, async (req, res) => {
  try {
    const { employeeId, roleId } = req.body;

    if (!employeeId || !roleId) {
      return res.status(400).json({ error: 'Employee ID and Role ID are required' });
    }

    const query = `
      UPDATE employees
      SET role_id = $1
      WHERE id = $2
      RETURNING *;
    `;
    const result = await pool.query(query, [roleId, employeeId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json({ message: 'Role assigned successfully' });
  } catch (error) {
    console.error('Error assigning role:', error);
    res.status(500).json({ error: 'Failed to assign role' });
  }
});

// Employee Routes
app.get('/getEmployes', async (req, res) => {
  try {
    const employees = await Employee.getAll();
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.get('/getEmployes/:id', async (req, res) => {
  try {
    const employee = await Employee.getById(req.params.id);
    if (!employee) {
      return res.status(404).json({ 
        error: 'Employee not found', 
        message: 'Employee not found' 
      });
    }
    res.json(employee);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.post('/saveEmployes', async (req, res) => {
  try {

    const { 
      first_name, 
      last_name, 
      email, 
      department, 
      hire_date, 
      phone_number, 
      address, 
      salary,
      mdp
    } = req.body;

    // Validate required fields
    if (!first_name || !last_name || !email || !department || !phone_number || !address) {
      return res.status(400).json({ 
        error: 'Validation error', 
        message: 'All fields except salary and password are required' 
      });
    }

    // Validate department enum
    if (!['Sales', 'Human Resource', 'Stock', 'Finance', 'Operations', 'Purchasing'].includes(department)) {
      return res.status(400).json({ 
        error: 'Validation error', 
        message: 'Invalid department' 
      });
    }

    const employee = await Employee.create(
      first_name,
      last_name,
      email,
      department,
      hire_date || new Date(),
      phone_number,
      address,
      salary || 0.00,
      mdp
    );


    res.status(201).json(employee);
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(400).json({ 
      error: 'Error adding employee', 
      message: error.message 
    });
  }
});

app.put('/updateEmployes/:id', async (req, res) => {
  try {
    const { 
      first_name, 
      last_name, 
      email, 
      department, 
      hire_date, 
      phone_number, 
      address, 
      salary,
      mdp
    } = req.body;

    // Validate department if provided
    if (department && !['Sales', 'Human Resource', 'Stock', 'Finance', 'Operations', 'Purchasing'].includes(department)) {
      return res.status(400).json({ 
        error: 'Validation error', 
        message: 'Invalid department' 
      });
    }

    const employee = await Employee.update(
      req.params.id,
      first_name,
      last_name,
      email,
      department,
      hire_date,
      phone_number,
      address,
      salary,
      mdp
    );

    if (!employee) {
      return res.status(404).json({ 
        error: 'Employee not found', 
        message: 'Employee not found' 
      });
    }

    res.json(employee);
  } catch (error) {
    console.error('Error updating employee:', error);
    res.status(400).json({ 
      error: 'Error updating employee', 
      message: error.message 
    });
  }
});

app.delete('/deleteEmployes/:id', async (req, res) => {
  try {
    const deleted = await Employee.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ 
        error: 'Employee not found', 
        message: 'Employee not found' 
      });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});


////////////////////////////////////////////////////////supplier//////////////////////////////////////////////////////



// Routes
app.get('/getsuppliers', async (req, res) => {
  try {
    const suppliers = await Supplier.getAll();
    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.get('/getsuppliers/:id', async (req, res) => {
  try {
    const supplier = await Supplier.getById(req.params.id);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found', message: 'Supplier not found' });
    res.json(supplier);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.post('/savesuppliers', async (req, res) => {
  try {
    const { name, email, phone, address, company, category, status, image } = req.body;
    const supplier = await Supplier.create(name, email, phone, address, company, category, status, image);
    res.status(201).json(supplier);
  } catch (error) {
    res.status(400).json({ error: 'Error adding supplier', message: error.message });
  }
});

app.put('/updatesuppliers/:id', async (req, res) => {
  try {
    const { name, email, phone, address, company, category, status, image } = req.body;
    const supplier = await Supplier.update(req.params.id, name, email, phone, address, company, category, status, image);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found', message: 'Supplier not found' });
    res.json(supplier);
  } catch (error) {
    res.status(400).json({ error: 'Error updating supplier', message: error.message });
  }
});

app.delete('/deletesuppliers/:id', async (req, res) => {
  try {
    const deleted = await Supplier.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Supplier not found', message: 'Supplier not found' });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

////////////////////////////////////////////////////////clients//////////////////////////////////////////////////




// Client Routes
app.get('/getclients', async (req, res) => {
  try {
    const clients = await Client.getAll();
    const formattedClients = clients.map(client => ({
      id: client.id,
      firstName: client.first_name,
      lastName: client.last_name,
      email: client.email,
      phone: client.phone,
      company: client.company,
      address: client.address,
      status: client.status
    }));
    res.json(formattedClients);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.get('/getclients/:id', async (req, res) => {
  try {
    const client = await Client.getById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found', message: 'Client not found' });
    res.json(client);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.post('/saveclients', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, company, address, status } = req.body;
    const client = await Client.create(firstName, lastName, email, phone, company, address, status);
    res.status(201).json(client);
  } catch (error) {
    res.status(400).json({ error: 'Error adding client', message: error.message });
  }
});

app.put('/updateclients/:id', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, company, address, status } = req.body;
    const client = await Client.update(req.params.id, firstName, lastName, email, phone, company, address, status);
    if (!client) return res.status(404).json({ error: 'Client not found', message: 'Client not found' });
    res.json(client);
  } catch (error) {
    res.status(400).json({ error: 'Error updating client', message: error.message });
  }
});

app.delete('/deleteclients/:id', async (req, res) => {
  try {
    const deleted = await Client.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Client not found', message: 'Client not found' });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});


app.get('/getproducts', async (req, res) => {
  try {
    const products = await Product.getAll();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Route pour récupérer un produit par ID
app.get('/getproducts/:id', async (req, res) => {
  try {
    const product = await Product.getById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found', message: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Route pour ajouter un produit
app.post('/saveproducts', upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, category, supplier, status } = req.body;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    if (!name || !price) {
      return res.status(400).json({ error: 'Error adding product', message: 'Name and price are required fields' });
    }

    const product = await Product.create(
      name,
      description,
      price,
      category,
      supplier,
      status,
      imagePath
    );

    res.status(201).json(product);
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(400).json({ error: 'Error adding product', message: error.message });
  }
});

// Route pour mettre à jour un produit
app.put('/updateproducts/:id', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, category, supplier, status } = req.body;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : undefined;

    if (!id) {
      return res.status(400).json({ error: 'Error updating product', message: 'Product ID is required' });
    }

    const updatedProduct = await Product.update(
      id,
      name,
      description,
      price,
      category,
      supplier,
      status,
      imagePath
    );

    res.json(updatedProduct);
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(400).json({
      error: 'Error updating product',
      message: error.message
    });
  }
});

// Route pour supprimer un produit
app.delete('/deleteproducts/:id', async (req, res) => {
  try {
    const deleted = await Product.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Product not found', message: 'Product not found' });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Route pour ajouter un mouvement de stock
app.post('/addstockmovement',authenticateToken,  async (req, res) => {
  try {
    const { product_id, movement_type, quantity, description } = req.body;
    if (!product_id || !movement_type || !quantity) {
      return res.status(400).json({ error: 'Error adding stock movement', message: 'Product ID, movement type, and quantity are required' });
    }
    if (!['entry', 'exit', 'adjustment'].includes(movement_type)) {
      return res.status(400).json({ error: 'Error adding stock movement', message: 'Invalid movement type' });
    }

    const result = await pool.query(
      'INSERT INTO public.stock_movement (product_id, movement_type, quantity, description) VALUES ($1, $2, $3, $4) RETURNING *',
      [product_id, movement_type, quantity, description || null]
    );

    // Récupérer la quantité actuelle après le mouvement
    const stockResult = await pool.query(
      'SELECT quantity FROM public.stock WHERE product_id = $1',
      [product_id]
    );
    const currentQuantity = stockResult.rows[0]?.quantity || 0;

    // Mettre à jour le statut si nécessaire (redondant avec le déclencheur, mais utile pour synchronisation)
    if (currentQuantity <= 0) {
      await pool.query(
        'UPDATE public.products SET status = $1 WHERE id = $2',
        ['out-of-stock', product_id]
      );
    } else {
      await pool.query(
        'UPDATE public.products SET status = $1 WHERE id = $2',
        ['in-stock', product_id]
      );
    }

    res.status(201).json({ ...result.rows[0], current_quantity: currentQuantity });
  } catch (err) {
    console.error('Error adding stock movement:', err.message);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});



// Get all stock movements
app.get('/api/stock-movements',  authenticateToken,async (req, res) => {
  try {
    const query = `
      SELECT 
        sm.*,
        p.name as product_name
      FROM stock_movement sm
      JOIN products p ON sm.product_id = p.id
      ORDER BY sm.movement_date DESC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching stock movements:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Get current stock levels
app.get('/api/stock', async (req, res) => {
  try {
    const query = `
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.status as product_status,
        COALESCE(s.quantity, 0) as quantity,
        COALESCE(s.updated_at, p.created_at) as updated_at
      FROM products p
      LEFT JOIN stock s ON p.id = s.product_id
      ORDER BY p.name
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching stock:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Get stock movement by ID
app.get('/api/stock-movements/:id', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        sm.*,
        p.name as product_name
      FROM stock_movement sm
      JOIN products p ON sm.product_id = p.id
      WHERE sm.id = $1
    `;
    const result = await pool.query(query, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Movement not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching stock movement:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Get stock movements by product
app.get('/api/stock-movements/product/:productId', authenticateToken,async (req, res) => {
  try {
    const query = `
      SELECT 
        sm.*,
        p.name as product_name
      FROM stock_movement sm
      JOIN products p ON sm.product_id = p.id
      WHERE sm.product_id = $1
      ORDER BY sm.movement_date DESC
    `;
    const result = await pool.query(query, [req.params.productId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching product stock movements:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});


  


//////////////////////////////////////////////////////////////////absences////////////////////////////////////////////



// Absence Routes
app.get('/api/absences',  async (req, res) => {
  try {
    const absences = await Absence.getAll();
    res.json(absences);
  } catch (error) {
    console.error('Error fetching absences:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

app.get('/api/absences/pending',  async (req, res) => {
  try {
    const pendingAbsences = await Absence.getPendingAbsences();
    res.json(pendingAbsences);
  } catch (error) {
    console.error('Error fetching pending absences:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

app.get('/api/absences/employee/:employeeId', async (req, res) => {
  try {
    const absences = await Absence.getByEmployeeId(req.params.employeeId);
    if (!absences.length) {
      return res.status(404).json({ 
        message: 'No absences found for this employee' 
      });
    }
    res.json(absences);
  } catch (error) {
    console.error('Error fetching employee absences:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

app.post('/api/absences',  authenticateToken,async (req, res) => {
  try {
    const { start_date, end_date, reason } = req.body;
    const employee_id = req.user.id;

    if (!start_date || !end_date || !reason) {
      return res.status(400).json({
        status: 'error',
        title: 'Missing Information',
        message: 'Please provide all required fields: start date, end date, and reason',
        icon: '❗'
      });
    }

    const absence = await Absence.create(
      employee_id,
      start_date,
      end_date,
      reason
    );

    res.status(201).json({
      status: 'success',
      title: 'Absence Request Created',
      message: 'Your absence request has been successfully submitted',
      icon: '✅',
      data: absence,
      details: {
        startDate: new Date(start_date).toLocaleDateString(),
        endDate: new Date(end_date).toLocaleDateString(),
        duration: `${Math.ceil((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24))} days`
      }
    });
  } catch (error) {
    res.status(400).json({
      status: 'error',
      title: 'Request Failed',
      message: 'Failed to create absence request',
      icon: '❌',
      details: error.message
    });
  }
});

app.put('/api/absences/:id/status', authenticateToken,async (req, res) => {
  try {
    const { status } = req.body;
    const absenceId = req.params.id;
    
    // Validate status
    const validStatuses = ['approved', 'rejected', 'pending'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid status value'
      });
    }

    // Check if user has permission (admin or manager)
   {/* if (req.user.role !== 'ADMIN' && req.user.role !== 'manager') {
      return res.status(403).json({
        status: 'error',
        message: 'Insufficient permissions to update request status'
      });
    }*/}

    // Update in database
    const updatedAbsence = await Absence.updateStatus(absenceId, status);
    
    if (!updatedAbsence) {
      return res.status(404).json({
        status: 'error',
        message: 'Absence request not found'
      });
    }

    res.json({
      status: 'success',
      message: `Request ${status} successfully`,
      data: updatedAbsence
    });

  } catch (error) {
    console.error('Error updating absence status:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update request status'
    });
  }
});

app.put('/api/absences/:id', authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date, reason } = req.body;
    const absenceId = req.params.id;

    // Check if absence exists
    const absence = await Absence.getById(absenceId);
    if (!absence) {
      return res.status(404).json({
        status: 'error',
        title: 'Not Found',
        message: 'Absence request not found',
        icon: '⚠️'
      });
    }

    // Verify user owns this request or is admin
    if (absence.employee_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        status: 'error',
        title: 'Permission Denied',
        message: 'You can only edit your own requests',
        icon: '🔒'
      });
    }

    // Validate dates
    if (new Date(start_date) > new Date(end_date)) {
      return res.status(400).json({
        status: 'error',
        title: 'Invalid Dates',
        message: 'Start date cannot be after end date',
        icon: '📅'
      });
    }

    // Update absence
    const updatedAbsence = await Absence.update(absenceId, {
      start_date,
      end_date,
      reason,
      status: 'pending'
    });

    // Send success response with detailed information
    res.json({
      status: 'success',
      title: 'Request Updated Successfully',
      message: 'Your absence request has been updated and is pending approval',
      icon: '✏️',
      data: updatedAbsence,
      details: {
        startDate: new Date(start_date).toLocaleDateString(),
        endDate: new Date(end_date).toLocaleDateString(),
        duration: `${Math.ceil((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24))} days`,
        status: 'pending'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating absence:', error);
    res.status(500).json({
      status: 'error',
      title: 'Update Failed',
      message: 'Failed to update absence request',
      icon: '⚠️',
      details: error.message
    });
  }
});


app.delete('/api/absences/:id', authenticateToken,async (req, res) => {
  try {
    const absence = await Absence.getById(req.params.id);
    
    if (!absence) {
      return res.status(404).json({ 
        error: 'Not found',
        message: 'Absence not found' 
      });
    }

    // Get user ID from the token
    const userId = req.user.id;
    const userRole = req.user.role;

    // Allow deletion if user is admin or the absence owner
    if (userRole !== 'admin' && absence.employee_id !== userId) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        message: 'You can only delete your own absences' 
      });
    }

    await Absence.delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting absence:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});
// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});