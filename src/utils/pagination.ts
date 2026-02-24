export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginationResult {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function parsePagination(query: Record<string, any>): PaginationParams {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  return { page, limit };
}

export function buildPaginationResult(
  page: number,
  limit: number,
  total: number,
): PaginationResult {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}
