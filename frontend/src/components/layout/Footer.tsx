/** Shared app footer. Lives in components/layout/, used by the authenticated shell. */
export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-gray-200 px-4 py-4 text-xs text-gray-500 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span>© {year} National Communication Authority, South Sudan</span>
        <span>NCA Data Collection Portal, v0.1 (demo)</span>
      </div>
    </footer>
  );
}
