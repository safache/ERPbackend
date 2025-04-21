const { pool }  = require('../config/db');

class ClientOrder {
  static async create(clientId, totalAmount) {
    const result = await pool.query(
      'INSERT INTO client_orders (client_id, total_amount, status, created_at, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *',
      [clientId, totalAmount, 'pending']
    );
    return result.rows[0];
  }

  static async addOrderDetail(clientOrderId, productId, quantity, priceAtTime) {
    const result = await pool.query(
      'INSERT INTO client_order_details (client_order_id, product_id, quantity, price_at_time) VALUES ($1, $2, $3, $4) RETURNING *',
      [clientOrderId, productId, quantity, priceAtTime]
    );
    return result.rows[0];
  }

  static async updateStatus(orderId, newStatus) {
    const validStatuses = ['pending', 'approved', 'rejected'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }
  
    const statusValue = String(newStatus);
  
    try {
      await pool.query('BEGIN');
      console.log('Executing status update:', statusValue, 'for order:', orderId);
  
      const result = await pool.query(
        'UPDATE client_orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [statusValue, orderId]
      );
  
      if (!result.rows[0]) {
        throw new Error('Client order not found');
      }
  
      // Handle stock updates when status changes to 'approved'
      if (statusValue === 'approved' && result.rows[0].status !== 'approved') {
        // Get order details with product information
        const details = await pool.query(
          'SELECT cod.product_id, cod.quantity, p.name as product_name FROM client_order_details cod JOIN products p ON cod.product_id = p.id WHERE cod.client_order_id = $1',
          [orderId]
        );
  
        // Update stock for each product
        for (const item of details.rows) {
          // Check current stock
          const stockResult = await pool.query(
            'SELECT quantity FROM stock WHERE product_id = $1',
            [item.product_id]
          );
  
          if (!stockResult.rows[0] || stockResult.rows[0].quantity < item.quantity) {
            await pool.query('ROLLBACK');
            throw new Error(`Insufficient stock for product: ${item.product_name}`);
          }
  
          // Update stock
          await pool.query(
            'UPDATE stock SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2',
            [item.quantity, item.product_id]
          );
  
          // Log stock movement
          await pool.query(
            'INSERT INTO stock_movement (product_id, movement_type, quantity, description, movement_date, created_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
            [
              item.product_id,
              'exit',
              item.quantity,
              `Stock reduction from approved client order #${orderId}`,
            ]
          );
        }
  
        // Verify updates
        const updatedStocks = await pool.query(
          'SELECT p.name, s.quantity FROM stock s JOIN products p ON s.product_id = p.id JOIN client_order_details cod ON s.product_id = cod.product_id WHERE cod.client_order_id = $1',
          [orderId]
        );
        console.log('Updated stock levels:', updatedStocks.rows);
      }
  
      await pool.query('COMMIT');
      return result.rows[0];
  
    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Error in updateStatus for client order:', error);
      throw error;
    }
  }
  
  static async getById(id) {
    const result = await pool.query(
      'SELECT co.*, c.first_name, c.last_name, c.email FROM client_orders co JOIN clients c ON co.client_id = c.id WHERE co.id = $1',
      [id]
    );
    return result.rows[0];
  }

  static async getOrderDetails(clientOrderId) {
    const result = await pool.query(
      'SELECT cod.*, p.name, p.price FROM client_order_details cod JOIN products p ON cod.product_id = p.id WHERE cod.client_order_id = $1',
      [clientOrderId]
    );
    return result.rows;
  }

  static async getAll() {
    const result = await pool.query(
      'SELECT co.*, c.first_name, c.last_name FROM client_orders co JOIN clients c ON co.client_id = c.id'
    );
    return result.rows;
  }
}

module.exports = ClientOrder;