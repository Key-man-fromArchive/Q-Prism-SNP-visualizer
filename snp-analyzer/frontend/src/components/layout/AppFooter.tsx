// @TASK feat/app-versioning — the running build, stated on every screen.
// @SPEC An operator reporting a problem has to be able to say which version
//       they are on; the analyzer runs from an image built out of a git URL,
//       so nothing else on screen answers that.

import { useEffect, useState } from "react";
import { getVersion } from "@/lib/api";
import type { VersionResponse } from "@/types/api";

export function AppFooter() {
  const [build, setBuild] = useState<VersionResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getVersion()
      .then(value => { if (!cancelled) setBuild(value); })
      // A footer is not worth an error state: if the instance cannot say what
      // it is, saying nothing is better than showing a wrong version.
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  if (!build) return null;

  return (
    <footer className="px-6 py-3 text-center text-xs text-text-muted print:hidden">
      <span data-testid="app-version">
        Q-prism® {build.version.startsWith("v") ? build.version : `v${build.version}`}
      </span>
      {build.commit && <span className="ml-2 font-mono">{build.commit}</span>}
      {build.built_at && <span className="ml-2">{build.built_at}</span>}
    </footer>
  );
}
