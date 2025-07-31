function errorHandler(err, req, res, next) {
    console.error('Error:', err);

    // Default error response
    let status = 500;
    let message = 'Internal Server Error';

    // Handle specific error types
    if (err.code === '23502') { // PostgreSQL not null violation
        status = 400;
        message = 'Missing required fields';
    } else if (err.code === '23505') { // PostgreSQL unique violation
        status = 409;
        message = 'Resource already exists';
    } else if (err.code === '23503') { // PostgreSQL foreign key violation
        status = 400;
        message = 'Invalid reference';
    } else if (err.name === 'ValidationError') {
        status = 400;
        message = err.message;
    } else if (err.name === 'JsonWebTokenError') {
        status = 401;
        message = 'Invalid token';
    } else if (err.name === 'TokenExpiredError') {
        status = 401;
        message = 'Token expired';
    }

    res.status(status).json({
        error: {
            message,
            status,
            timestamp: new Date().toISOString(),
            path: req.path,
            method: req.method
        }
    });
}

function notFoundHandler(req, res) {
    res.status(404).json({
        error: {
            message: 'Not Found',
            status: 404,
            timestamp: new Date().toISOString(),
            path: req.path,
            method: req.method
        }
    });
}

module.exports = {
    errorHandler,
    notFoundHandler
};