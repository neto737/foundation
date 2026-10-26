// Reconhece também variantes não canônicas antes dos middlewares que revelam erros.
export function administrativePath(path: string): boolean {
  let decoded = path;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  decoded = decoded.replaceAll("\\", "/");
  decoded = decoded.replace(/\/+/g, "/").toLowerCase();
  return decoded.startsWith("/admin") || decoded.startsWith("/api/admin");
}
