/**
 * What a printed sheet says about itself.
 *
 * On screen, "which page is this?" is answered by the URL, the navigation and the title bar. On
 * paper none of that exists, and a page of figures with no operator, no period and no date is not
 * evidence of anything — it is a page of figures. A regulator prints a filed return to put in a
 * case file and a filtered audit view to attach to a letter, and both have to be identifiable
 * months later by somebody who was not there when it was printed.
 *
 * So this replaces the chrome the print stylesheet removes: what the page is, who took it, and
 * when. It renders on every screen because the alternative is remembering to add it to each one,
 * and the pages most worth printing are not the ones anybody would think to decorate.
 *
 * Hidden on screen by `.print-header` in `index.css`; the same rule reveals it inside `@media
 * print`.
 */
export function PrintHeader({ title, takenBy }: { title: string; takenBy?: string }) {
  /*
   * The timestamp is read at render, not at print time.
   *
   * A `window.beforeprint` handler would be a minute more accurate and would also mean the page
   * mutating itself while the browser is measuring it for pagination. What matters here is the day
   * and roughly the hour, which is what a case file records.
   */
  const printedAt = new Date().toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return (
    <div className="print-header">
      <div style={{ fontSize: '10pt', fontWeight: 600 }}>National Communications Authority</div>
      <div style={{ fontSize: '14pt', fontWeight: 700, marginTop: '1mm' }}>{title}</div>
      <div style={{ fontSize: '9pt', marginTop: '2mm' }}>
        Printed {printedAt}
        {takenBy ? ` by ${takenBy}` : ''}
      </div>
    </div>
  );
}
