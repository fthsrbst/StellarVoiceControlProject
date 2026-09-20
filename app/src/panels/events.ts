import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { PolarisEvent } from "@polaris/interfaces";

import { listenPolarisEvents } from "@/lib/polaris";

/**
 * Subscribes a panel to the typed `polaris-event` stream while it is mounted.
 *
 * The listener and the runtime guard live in `@/lib/polaris`, so a panel can
 * never invent a second wire format; this hook only owns the mount/unmount
 * lifecycle. `handler` must be stable across renders (wrap it in `useCallback`),
 * otherwise the subscription is torn down and rebuilt on every render.
 */
export function usePolarisEvents(handler: (event: PolarisEvent) => void): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listenPolarisEvents((event) => {
      if (!disposed) handler(event);
    })
      .then((stop) => {
        // The listener may resolve after unmount in StrictMode.
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error: unknown) => {
        console.warn("panel could not subscribe to polaris-event", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handler]);
}
