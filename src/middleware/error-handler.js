export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).render('error', {
    title: 'Error',
    message: err.message || 'An unexpected error occurred',
    details: process.env.NODE_ENV === 'development' ? err.stack : null,
  });
}
