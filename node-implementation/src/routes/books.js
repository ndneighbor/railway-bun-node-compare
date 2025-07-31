const express = require('express');
const db = require('../database/connection');
const router = express.Router();

// GET /api/books - List books with pagination and filtering
router.get('/', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = (page - 1) * limit;
        const { genre, author, minPrice, maxPrice, search } = req.query;

        let query = `
            SELECT b.*, a.name as author_name 
            FROM books b 
            LEFT JOIN authors a ON b.author_id = a.id 
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (genre) {
            query += ` AND b.genre ILIKE $${paramIndex}`;
            params.push(`%${genre}%`);
            paramIndex++;
        }

        if (author) {
            query += ` AND a.name ILIKE $${paramIndex}`;
            params.push(`%${author}%`);
            paramIndex++;
        }

        if (minPrice) {
            query += ` AND b.price >= $${paramIndex}`;
            params.push(parseFloat(minPrice));
            paramIndex++;
        }

        if (maxPrice) {
            query += ` AND b.price <= $${paramIndex}`;
            params.push(parseFloat(maxPrice));
            paramIndex++;
        }

        if (search) {
            query += ` AND (b.title ILIKE $${paramIndex} OR b.description ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        // Get total count for pagination
        const countQuery = query.replace('SELECT b.*, a.name as author_name', 'SELECT COUNT(*)');
        const countResult = await db.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        // Add pagination
        query += ` ORDER BY b.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await db.query(query, params);

        res.json({
            books: result.rows,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/books/:id - Get book details
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query(`
            SELECT b.*, a.name as author_name, a.bio as author_bio
            FROM books b 
            LEFT JOIN authors a ON b.author_id = a.id 
            WHERE b.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        next(error);
    }
});

// POST /api/books - Create new book (admin)
router.post('/', async (req, res, next) => {
    try {
        const { title, author_id, price, stock, description, genre, isbn, cover_url } = req.body;

        if (!title || !author_id || !price) {
            return res.status(400).json({ error: 'Missing required fields: title, author_id, price' });
        }

        const result = await db.query(`
            INSERT INTO books (title, author_id, price, stock, description, genre, isbn, cover_url)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [title, author_id, price, stock || 0, description, genre, isbn, cover_url]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        next(error);
    }
});

// PUT /api/books/:id - Update book (admin)
router.put('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { title, author_id, price, stock, description, genre, isbn, cover_url } = req.body;

        const result = await db.query(`
            UPDATE books 
            SET title = COALESCE($1, title),
                author_id = COALESCE($2, author_id),
                price = COALESCE($3, price),
                stock = COALESCE($4, stock),
                description = COALESCE($5, description),
                genre = COALESCE($6, genre),
                isbn = COALESCE($7, isbn),
                cover_url = COALESCE($8, cover_url)
            WHERE id = $9
            RETURNING *
        `, [title, author_id, price, stock, description, genre, isbn, cover_url, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        next(error);
    }
});

// DELETE /api/books/:id - Delete book (admin)
router.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query('DELETE FROM books WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }

        res.json({ message: 'Book deleted successfully' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;