import { PaginationQueryDto } from '../dto/pagination-query.dto';

/** Standard envelope for every paginated list response. */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

/** Translate a page/pageSize query into Prisma `skip`/`take`. */
export function toSkipTake(query: Pick<PaginationQueryDto, 'page' | 'pageSize'>): {
  skip: number;
  take: number;
} {
  return {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  };
}

/**
 * Build the standard `{ data, meta }` envelope. Pair `rows` with the `total`
 * count taken in the same `prisma.$transaction` so the count matches the page.
 */
export function paginate<T>(
  rows: T[],
  total: number,
  query: Pick<PaginationQueryDto, 'page' | 'pageSize'>,
): Paginated<T> {
  const totalPages = Math.ceil(total / query.pageSize) || 0;
  return {
    data: rows,
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages,
      hasNext: query.page < totalPages,
      hasPrev: query.page > 1,
    },
  };
}
