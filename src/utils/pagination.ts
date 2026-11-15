export const PATIENT_PAGE_SIZE = 30;
export function paginatePatients<T>(items: T[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / PATIENT_PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Math.floor(requestedPage) || 1));
  const start = (page - 1) * PATIENT_PAGE_SIZE;
  return { page, pageCount, items: items.slice(start, start + PATIENT_PAGE_SIZE),
    from: items.length ? start + 1 : 0, to: Math.min(start + PATIENT_PAGE_SIZE, items.length) };
}
