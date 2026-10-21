import Link from 'next/link';
import { customerPageHref, type PageInfo } from '@/lib/customers';

export function Pagination({
  info,
  path,
  query = '',
  label,
}: {
  info: PageInfo;
  path: string;
  query?: string;
  label: string;
}) {
  if (!info.total) return null;
  const start = (info.page - 1) * info.page_size + 1;
  return (
    <nav aria-label={label} className="customer-pagination">
      <p>
        {start}–{Math.min(info.page * info.page_size, info.total)} of {info.total}
      </p>
      <div>
        {info.page > 1 && (
          <Link
            className="button secondary small"
            href={customerPageHref(path, info.page - 1, query)}
          >
            Previous
          </Link>
        )}
        <span>
          Page {info.page} of {info.pages}
        </span>
        {info.page < info.pages && (
          <Link
            className="button secondary small"
            href={customerPageHref(path, info.page + 1, query)}
          >
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}
