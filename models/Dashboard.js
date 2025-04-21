const { pool } = require('../config/db');

class Dashboard {
  static async getDashboardStats() {
    try {
      // Start all queries in parallel for better performance
      const [
        orderStats,
        revenue,
        outOfStock,
        recentOrders,
        lowStock,
        stockMovements,
        employeeStats,
        monthlyRevenue,
        // Add new purchaseOrdersTotal query
        purchaseOrdersTotal
      ] = await Promise.all([
        // 1. Order statistics by status
        pool.query(`
          SELECT status, COUNT(*) as count 
          FROM client_orders 
          GROUP BY status
          ORDER BY status
        `),

        // 2. Daily revenue for last 7 days
        pool.query(`
          WITH RECURSIVE date_series AS (
            SELECT CURRENT_DATE - INTERVAL '6 days' as date
            UNION ALL
            SELECT date + INTERVAL '1 day'
            FROM date_series
            WHERE date < CURRENT_DATE
          ),
          daily_revenue AS (
            SELECT 
              DATE_TRUNC('day', created_at)::date as date,
              COALESCE(SUM(total_amount), 0) as total
            FROM client_orders 
            WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY DATE_TRUNC('day', created_at)
          )
          SELECT 
            ds.date,
            COALESCE(dr.total, 0) as total
          FROM date_series ds
          LEFT JOIN daily_revenue dr ON ds.date = dr.date
          ORDER BY ds.date DESC
        `),

        // 3. Out of stock products count
        pool.query(`
          SELECT COUNT(*) as count
          FROM stock
          WHERE quantity <= 0
        `),

        // 4. Recent orders with client info
        pool.query(`
          SELECT 
            co.id,
            co.status,
            co.total_amount,
            c.first_name || ' ' || c.last_name as client_name,
            co.created_at
          FROM client_orders co
          JOIN clients c ON co.client_id = c.id
          ORDER BY co.created_at DESC
          LIMIT 10
        `),

        // 5. Low stock products
        pool.query(`
          SELECT 
            p.id,
            p.name,
            s.quantity,
            p.category
          FROM products p
          JOIN stock s ON p.id = s.product_id
          WHERE s.quantity <= 20
          ORDER BY s.quantity ASC
        `),

        // 6. Recent stock movements
        pool.query(`
          SELECT 
            sm.id,
            p.name as product_name,
            sm.movement_type,
            sm.quantity,
            sm.description,
            sm.movement_date
          FROM stock_movement sm
          JOIN products p ON sm.product_id = p.id
          ORDER BY sm.movement_date DESC
          LIMIT 10
        `),

        // 7. Employee statistics
        pool.query(`
          SELECT role, COUNT(*) as count
          FROM employees
          GROUP BY role
          ORDER BY count DESC
        `),

        // 8. Monthly revenue
        pool.query(`
          SELECT 
            DATE_TRUNC('month', created_at) as month,
            SUM(total_amount) as total
          FROM client_orders
          WHERE status = 'approved'
            AND created_at >= NOW() - INTERVAL '2 months'
          GROUP BY DATE_TRUNC('month', created_at)
          ORDER BY month DESC
        `),

        // 9. Total Purchase Orders Amount
        pool.query(`
          SELECT 
            COUNT(*) as order_count,
            COALESCE(SUM(total_amount), 0) as total_amount,
            COALESCE(SUM(CASE WHEN status = 'approved' THEN total_amount ELSE 0 END), 0) as approved_amount
          FROM purchase_orders
          WHERE created_at >= NOW() - INTERVAL '30 days'
        `)
      ]);

      return {
        orderStats: orderStats.rows,
        revenueLastWeek: revenue.rows,
        outOfStockCount: outOfStock.rows[0].count,
        recentOrders: recentOrders.rows,
        lowStockProducts: lowStock.rows,
        recentStockMovements: stockMovements.rows,
        employeeStats: employeeStats.rows,
        monthlyRevenue: monthlyRevenue.rows,
        purchaseOrdersStats: {
          totalAmount: purchaseOrdersTotal.rows[0].total_amount,
          approvedAmount: purchaseOrdersTotal.rows[0].approved_amount,
          orderCount: purchaseOrdersTotal.rows[0].order_count
        }
      };
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      throw error;
    }
  }
}

module.exports = Dashboard;