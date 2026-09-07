/** Parse SSE across arbitrary byte boundaries, including CRLF and multibyte text. */
export async function* readSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '',
    data: string[] = [];
  const consume = (line: string): string | undefined => {
    if (line === '') {
      const result = data.length ? data.join('\n') : undefined;
      data = [];
      return result;
    }
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    return undefined;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        const event = consume(line);
        if (event !== undefined) yield event;
      }
      if (done) {
        if (buffer) consume(buffer.replace(/\r$/, ''));
        const last = consume('');
        if (last !== undefined) yield last;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
