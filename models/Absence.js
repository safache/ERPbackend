const { pool }  = require('../config/db');

class Absence {
  static async getAll() {
    try {
      const result = await pool.query(`
        SELECT 
          a.*,
          e.first_name as requester_first_name,
          e.last_name as requester_last_name,
          e.email as requester_email,
          CONCAT(e.first_name, ' ', e.last_name) as requester_full_name
        FROM absences a
        JOIN employees e ON a.employee_id = e.id
        ORDER BY a.created_at DESC
      `);
      return result.rows;
    } catch (error) {
      console.error('Error in Absence.getAll:', error);
      throw error;
    }
  }

  static async updateStatus(id, status) {
    try {
      const result = await pool.query(
        'UPDATE absences SET status = $1 WHERE id = $2 RETURNING *',
        [status, id]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error in Absence.updateStatus:', error);
      throw error;
    }
  }

  static async getById(id) {
    try {
      const result = await pool.query(`
        SELECT 
          a.*,
          e.first_name as requester_first_name,
          e.last_name as requester_last_name,
          e.email as requester_email,
          CONCAT(e.first_name, ' ', e.last_name) as requester_full_name
        FROM absences a
        JOIN employees e ON a.employee_id = e.id
        WHERE a.id = $1
      `, [id]);
      return result.rows[0];
    } catch (error) {
      console.error('Error in Absence.getById:', error);
      throw error;
    }
  }

  static async getByEmployeeId(employeeId) {
    try {
      const result = await pool.query(`
        SELECT a.*, 
               e.first_name, 
               e.last_name,
               e.email
        FROM absences a
        JOIN employees e ON a.employee_id = e.id
        WHERE a.employee_id = $1
        ORDER BY a.created_at DESC
      `, [employeeId]);
      return result.rows;
    } catch (error) {
      console.error('Error in Absence.getByEmployeeId:', error);
      throw error;
    }
  }

  static async create(employeeId, startDate, endDate, reason) {
    try {
      const result = await pool.query(`
        INSERT INTO absences (
          employee_id, 
          start_date, 
          end_date, 
          reason,
          status
        ) 
        VALUES ($1, $2, $3, $4, 'pending')
        RETURNING *
      `, [
        employeeId,
        startDate,
        endDate,
        reason
      ]);

      return result.rows[0];
    } catch (error) {
      console.error('Error in Absence.create:', error);
      throw error;
    }
  }

  static async update(id, data) {
    try {
      // Extract fields from the data object
      const { start_date, end_date, reason, status } = data;
  
      // Build the SET clause dynamically
      const setClauses = [];
      const values = [];
      let paramIndex = 1;
  
      if (start_date !== undefined) {
        setClauses.push(`start_date = $${paramIndex++}`);
        values.push(start_date);
      }
      if (end_date !== undefined) {
        setClauses.push(`end_date = $${paramIndex++}`);
        values.push(end_date);
      }
      if (reason !== undefined) {
        setClauses.push(`reason = $${paramIndex++}`);
        values.push(reason);
      }
      if (status !== undefined) {
        setClauses.push(`status = $${paramIndex++}`);
        values.push(status);
      }
  
      // Add updated_at and id parameters
      setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id); // id is the last parameter ($N)
  
      // Construct the final query
      const query = `
        UPDATE absences 
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIndex} 
        RETURNING *
      `;
  
      const result = await pool.query(query, values);
  
      return result.rows[0];
    } catch (error) {
      console.error('Error in Absence.update:', error);
      throw error;
    }
  }

  static async delete(id) {
    try {
      const result = await pool.query(
        'DELETE FROM absences WHERE id = $1 RETURNING *',
        [id]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error in Absence.delete:', error);
      throw error;
    }
  }

  static async getPendingAbsences() {
    try {
      const result = await pool.query(`
        SELECT a.*, 
               e.first_name, 
               e.last_name,
               e.email
        FROM absences a
        JOIN employees e ON a.employee_id = e.id
        WHERE a.status = 'pending'
        ORDER BY a.created_at DESC
      `);
      return result.rows;
    } catch (error) {
      console.error('Error in Absence.getPendingAbsences:', error);
      throw error;
    }
  }

  static async validateDates(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) {
      throw new Error('End date must be after or equal to start date');
    }
    return true;
  }
}

module.exports = Absence;