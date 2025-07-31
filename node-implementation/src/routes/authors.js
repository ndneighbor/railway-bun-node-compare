const express = require('express');
const db = require('../database/connection');
const router = express.Router();

// GET /api/authors - List authors
router.get('/', async (req, res, next) => {
    try {
        const result = await db.query(`
            SELECT a.*, COUNT(b.id) as book_count
            FROM authors a
            LEFT JOIN books b ON a.id = b.author_id
            GROUP BY a.id
            ORDER BY a.name
        `);

        res.json(result.rows);
    } catch (error) {
        next(error);
    }
});

// GET /api/authors/:id - Get author with their books
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;

        // Get author details
        const authorResult = await db.query('SELECT * FROM authors WHERE id = $1', [id]);
        
        if (authorResult.rows.length === 0) {
            return res.status(404).json({ error: 'Author not found' });
        }

        // Get author's books
        const booksResult = await db.query(`
            SELECT * FROM books 
            WHERE author_id = $1 
            ORDER BY created_at DESC
        `, [id]);

        const author = authorResult.rows[0];
        author.books = booksResult.rows;

        res.json(author);
    } catch (error) {
        next(error);
    }
});

// POST /api/authors - Create author (admin)
router.post('/', async (req, res, next) => {
    try {
        const { name, bio } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Missing required field: name' });
        }

        const result = await db.query(`
            INSERT INTO authors (name, bio)
            VALUES ($1, $2)
            RETURNING *
        `, [name, bio]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        next(error);
    }
});

// PUT /api/authors/:id - Update author (admin)
router.put('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, bio } = req.body;

        const result = await db.query(`
            UPDATE authors 
            SET name = COALESCE($1, name),
                bio = COALESCE($2, bio)
            WHERE id = $3
            RETURNING *
        `, [name, bio, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Author not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        next(error);
    }
});

// DELETE /api/authors/:id - Delete author (admin)
router.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check if author has books
        const booksResult = await db.query('SELECT COUNT(*) FROM books WHERE author_id = $1', [id]);
        const bookCount = parseInt(booksResult.rows[0].count);

        if (bookCount > 0) {
            return res.status(400).json({ 
                error: `Cannot delete author with ${bookCount} books. Delete books first.` 
            });
        }

        const result = await db.query('DELETE FROM authors WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Author not found' });
        }

        res.json({ message: 'Author deleted successfully' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;