const express = require('express');
const db = require('../database/connection');
const router = express.Router();

// POST /api/orders - Create new order
router.post('/', async (req, res, next) => {
    try {
        const { items, customer_email } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Missing required field: items (non-empty array)' });
        }

        if (!customer_email) {
            return res.status(400).json({ error: 'Missing required field: customer_email' });
        }

        // Use transaction for order creation
        const result = await db.transaction(async (client) => {
            // Calculate total and validate items
            let total = 0;
            const validatedItems = [];

            for (const item of items) {
                const { book_id, quantity } = item;

                if (!book_id || !quantity || quantity <= 0) {
                    throw new Error('Each item must have book_id and positive quantity');
                }

                // Get book details and check stock
                const bookResult = await client.query(
                    'SELECT id, title, price, stock FROM books WHERE id = $1',
                    [book_id]
                );

                if (bookResult.rows.length === 0) {
                    throw new Error(`Book with id ${book_id} not found`);
                }

                const book = bookResult.rows[0];

                if (book.stock < quantity) {
                    throw new Error(`Insufficient stock for book "${book.title}". Available: ${book.stock}, requested: ${quantity}`);
                }

                const itemTotal = parseFloat(book.price) * quantity;
                total += itemTotal;

                validatedItems.push({
                    book_id,
                    quantity,
                    price: book.price,
                    title: book.title
                });

                // Update stock
                await client.query(
                    'UPDATE books SET stock = stock - $1 WHERE id = $2',
                    [quantity, book_id]
                );
            }

            // Create order
            const orderResult = await client.query(
                'INSERT INTO orders (total, customer_email) VALUES ($1, $2) RETURNING *',
                [total, customer_email]
            );

            const order = orderResult.rows[0];

            // Create order items
            for (const item of validatedItems) {
                await client.query(
                    'INSERT INTO order_items (order_id, book_id, quantity, price) VALUES ($1, $2, $3, $4)',
                    [order.id, item.book_id, item.quantity, item.price]
                );
            }

            return { ...order, items: validatedItems };
        });

        res.status(201).json(result);
    } catch (error) {
        next(error);
    }
});

// GET /api/orders/:id - Get order details
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;

        // Get order details
        const orderResult = await db.query('SELECT * FROM orders WHERE id = $1', [id]);

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Get order items with book details
        const itemsResult = await db.query(`
            SELECT oi.*, b.title, b.isbn, b.cover_url
            FROM order_items oi
            JOIN books b ON oi.book_id = b.id
            WHERE oi.order_id = $1
        `, [id]);

        const order = orderResult.rows[0];
        order.items = itemsResult.rows;

        res.json(order);
    } catch (error) {
        next(error);
    }
});

// PUT /api/orders/:id/status - Update order status (admin)
router.put('/:id/status', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
        
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ 
                error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
            });
        }

        const result = await db.query(
            'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
            [status, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        next(error);
    }
});

// GET /api/orders - List orders (admin)
router.get('/', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = (page - 1) * limit;
        const { status } = req.query;

        let query = 'SELECT * FROM orders';
        const params = [];

        if (status) {
            query += ' WHERE status = $1';
            params.push(status);
        }

        // Get total count
        const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
        const countResult = await db.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        // Add pagination
        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await db.query(query, params);

        res.json({
            orders: result.rows,
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

module.exports = router;