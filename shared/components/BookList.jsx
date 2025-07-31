import React from 'react';

export function BookList({ books, pagination, filters, onPageChange, onFilterChange }) {
    return (
        <div className="book-list">
            <div className="filters">
                <input
                    type="text"
                    placeholder="Search books..."
                    value={filters.search || ''}
                    onChange={(e) => onFilterChange({ ...filters, search: e.target.value })}
                    className="search-input"
                />
                <select
                    value={filters.genre || ''}
                    onChange={(e) => onFilterChange({ ...filters, genre: e.target.value })}
                    className="genre-filter"
                >
                    <option value="">All Genres</option>
                    <option value="Fiction">Fiction</option>
                    <option value="Science Fiction">Science Fiction</option>
                    <option value="Romance">Romance</option>
                    <option value="Mystery">Mystery</option>
                    <option value="Horror">Horror</option>
                    <option value="Literary Fiction">Literary Fiction</option>
                    <option value="Adventure">Adventure</option>
                    <option value="Biography">Biography</option>
                </select>
                <input
                    type="number"
                    placeholder="Min Price"
                    value={filters.minPrice || ''}
                    onChange={(e) => onFilterChange({ ...filters, minPrice: e.target.value })}
                    className="price-filter"
                />
                <input
                    type="number"
                    placeholder="Max Price"
                    value={filters.maxPrice || ''}
                    onChange={(e) => onFilterChange({ ...filters, maxPrice: e.target.value })}
                    className="price-filter"
                />
            </div>
            
            <div className="books-grid">
                {books.map(book => (
                    <div key={book.id} className="book-card">
                        {book.cover_url && (
                            <img src={book.cover_url} alt={book.title} className="book-cover" />
                        )}
                        <div className="book-info">
                            <h3 className="book-title">{book.title}</h3>
                            <p className="book-author">by {book.author_name}</p>
                            <p className="book-genre">{book.genre}</p>
                            <p className="book-price">${parseFloat(book.price).toFixed(2)}</p>
                            <p className="book-stock">
                                {book.stock > 0 ? `${book.stock} in stock` : 'Out of stock'}
                            </p>
                            {book.description && (
                                <p className="book-description">
                                    {book.description.length > 150 
                                        ? `${book.description.substring(0, 150)}...` 
                                        : book.description
                                    }
                                </p>
                            )}
                            <div className="book-actions">
                                <a href={`/books/${book.id}`} className="btn btn-primary">
                                    View Details
                                </a>
                                {book.stock > 0 && (
                                    <button className="btn btn-secondary">
                                        Add to Cart
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            
            {pagination && pagination.pages > 1 && (
                <div className="pagination">
                    <button 
                        disabled={pagination.page <= 1}
                        onClick={() => onPageChange(pagination.page - 1)}
                        className="btn btn-outline"
                    >
                        Previous
                    </button>
                    
                    <span className="pagination-info">
                        Page {pagination.page} of {pagination.pages} 
                        ({pagination.total} total books)
                    </span>
                    
                    <button 
                        disabled={pagination.page >= pagination.pages}
                        onClick={() => onPageChange(pagination.page + 1)}
                        className="btn btn-outline"
                    >
                        Next
                    </button>
                </div>
            )}
            
            {books.length === 0 && (
                <div className="no-results">
                    <h3>No books found</h3>
                    <p>Try adjusting your search criteria or browse all books.</p>
                </div>
            )}
        </div>
    );
}