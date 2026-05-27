const RESERVED_ROOT_SEGMENTS = new Set(["api", "assets", "templates"]);

export function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.replace(/\/+$/, "") : value;
}

export function runtimeMountPath(): string {
  const viteBase = import.meta.env.BASE_URL || "/";
  if (viteBase && viteBase !== "/" && viteBase !== "./") {
    return trimTrailingSlash(viteBase);
  }

  if (typeof window === "undefined") return "";

  const firstSegment = window.location.pathname.split("/").filter(Boolean)[0];
  if (!firstSegment || RESERVED_ROOT_SEGMENTS.has(firstSegment)) return "";

  return `/${firstSegment}`;
}

export function runtimeApiBasePath(): string {
  const configured = import.meta.env.VITE_API_BASE_PATH;
  if (configured) return trimTrailingSlash(configured);

  const mountPath = runtimeMountPath();
  return `${mountPath}/api`;
}

export function runtimeAssetPath(path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  const mountPath = runtimeMountPath();
  return `${mountPath}/${normalizedPath}`;
}
