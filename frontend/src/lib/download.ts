/**
 * Hand a blob to the browser as a file to save.
 *
 * One place, because there were six copies of these six lines and they had all inherited the same
 * bug: the object URL was revoked on the line after the click. A click on an anchor does not start
 * the download synchronously, it queues it, and revoking the URL before the browser gets to it
 * pulls the bytes out from under the download. Chrome usually wins that race and sometimes does
 * not, which is the worst kind of defect to own: it works on the machine it was written on and a
 * file occasionally fails to arrive for somebody else.
 *
 * So the revoke is deferred to a later task, and the anchor is removed with it. The blob lives a
 * fraction of a second longer and the download always has something to read.
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  // A macrotask, not a microtask: the download has to be handed to the browser's own queue first,
  // and a promise callback still runs before that happens.
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * The file name the server asked for, or the fallback.
 *
 * Servers that generate a file name put the date in it, which is what makes two exports of the
 * same report tellable apart in a downloads folder. Parsed here so the three callers that care do
 * not each write the same regular expression.
 */
export function fileNameFromDisposition(disposition: unknown, fallback: string): string {
  const match = /filename="?([^"]+)"?/.exec(String(disposition ?? ''));
  return match?.[1] ?? fallback;
}
