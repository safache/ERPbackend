const { pool }  = require('../config/db');

class PurchaseOrder {
  static async create(supplierId, totalAmount) {
    const result = await pool.query(
      'INSERT INTO purchase_orders (supplier_id, total_amount) VALUES ($1, $2) RETURNING *',
      [supplierId, totalAmount]
    );
    return result.rows[0];
  }

  static async addOrderDetail(purchaseOrderId, productId, quantity, priceAtTime) {
    const result = await pool.query(
      'INSERT INTO purchase_order_details (purchase_order_id, product_id, quantity, price_at_time) VALUES ($1, $2, $3, $4) RETURNING *',
      [purchaseOrderId, productId, quantity, priceAtTime]
    );
    return result.rows[0];
  }

  static async updateStatus(orderId, newStatus) {
    const validStatuses = ['pending', 'approved', 'rejected', 'shipped', 'delivered'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }

    const statusValue = String(newStatus);

    try {
      console.log('Updating order status:', { orderId, newStatus });
      
      await pool.query('BEGIN');

      // First check if order exists and get current status
      const checkOrder = await pool.query(
        'SELECT status FROM purchase_orders WHERE id = $1',
        [orderId]
      );

      if (!checkOrder.rows[0]) {
        throw new Error(`Purchase order ${orderId} not found`);
      }

      // Update the status
      const result = await pool.query(
        `UPDATE purchase_orders 
         SET status = $1, 
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 
         RETURNING *`,
        [statusValue, orderId]
      );

      if (!result.rows[0]) {
        throw new Error('Status update failed');
      }

      // Log the status change
      console.log('Status updated:', {
        orderId,
        oldStatus: checkOrder.rows[0].status,
        newStatus: statusValue
      });

      // Verify stock updates when approved
      if (statusValue === 'approved' && checkOrder.rows[0].status !== 'approved') {
        const updatedStocks = await pool.query(
          `SELECT p.name, s.quantity 
           FROM stock s 
           JOIN products p ON s.product_id = p.id 
           JOIN purchase_order_details pod ON s.product_id = pod.product_id 
           WHERE pod.purchase_order_id = $1`,
          [orderId]
        );
        console.log('Stock levels after update:', updatedStocks.rows);
      }

      await pool.query('COMMIT');
      return result.rows[0];

    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Error updating order status:', {
        orderId,
        newStatus,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  static async getById(id) {
    const result = await pool.query(
      'SELECT po.*, s.name, s.email FROM purchase_orders po JOIN suppliers s ON po.supplier_id = s.id WHERE po.id = $1',
      [id]
    );
    return result.rows[0];
  }

  static async getOrderDetails(purchaseOrderId) {
    const result = await pool.query(
      'SELECT pod.*, p.name, p.price FROM purchase_order_details pod JOIN products p ON pod.product_id = p.id WHERE pod.purchase_order_id = $1',
      [purchaseOrderId]
    );
    return result.rows;
  }

  static async getAll() {
    const result = await pool.query(
      'SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON po.supplier_id = s.id'
    );
    return result.rows;
  }


  static async findById(id) {
    const result = await pool.query(
      'SELECT po.*, s.name as supplier_name FROM purchase_orders po JOIN suppliers s ON po.supplier_id = s.id WHERE po.id = $1',
      [id]
    );
    return result.rows[0];
  }

  static async getOrderItems(orderId) {
    const result = await pool.query(
      `SELECT 
        poi.*,
        p.name as product_name,
        p.price
      FROM purchase_order_details poi
      JOIN products p ON poi.product_id = p.id
      WHERE poi.purchase_order_id = $1`,
      [orderId]
    );
    return result.rows;
  }

  static async updateOrder(id, data) {
    try {
      await pool.query('BEGIN');
      
      // Update purchase order
      await pool.query(
        'UPDATE purchase_orders SET total_amount = $1 WHERE id = $2 RETURNING *',
        [data.totalAmount, id]
      );

      // Delete existing items
      await pool.query(
        'DELETE FROM purchase_order_details WHERE purchase_order_id = $1',
        [id]
      );

      // Insert new items
      for (const item of data.items) {
        await pool.query(
          'INSERT INTO purchase_order_details (purchase_order_id, product_id, quantity) VALUES ($1, $2, $3)',
          [id, item.productId, item.quantity]
        );
      }

      await pool.query('COMMIT');
      return true;
    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Error updating purchase order:', error);
      throw error;
    }
  }

  static async deleteOrder(id) {
    try {
      await pool.query('BEGIN');
      
      // Delete order items first (due to foreign key constraint)
      await pool.query(
        'DELETE FROM purchase_order_details WHERE purchase_order_id = $1',
        [id]
      );

      // Delete related stock movements
      await pool.query(
        "DELETE FROM stock_movement WHERE description LIKE $1",
        [`%purchase order #${id}%`]
      );

      // Delete the order
      const result = await pool.query(
        'DELETE FROM purchase_orders WHERE id = $1 RETURNING *',
        [id]
      );

      await pool.query('COMMIT');
      return result.rows[0];

    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Error deleting purchase order:', error);
      throw error;
    }
  }
}


module.exports = PurchaseOrder;