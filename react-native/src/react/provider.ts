/*
 * The provider, and the context every hook reads.
 *
 * The brand is made during the first render rather than in an effect, so
 * a snapshot is already in place before anything paints. Tearing it down
 * is deferred by a tick: React deliberately mounts, unmounts and remounts
 * a tree in development to catch bugs, and a brand that closed its
 * channel on that first unmount would come back dead.
 */

import { createContext, createElement, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { createBrand } from "../core/brand";
import type {
  Brand,
  BrandOptions,
  FontPolicy,
  LivePolicy,
} from "../core/brand";
import type { BrandSnapshot } from "../core/snapshot";
import type { StorageAdapter } from "../core/storage";
import type { Appearance } from "../protocol/params";
import { cancel, later } from "../platform/globals";

export const BrandContext = createContext<Brand | null>(null);

export interface DesignlessProviderProps {
  /** The public id of the brand. */
  publicId: string;
  /**
   * The publishable key. Named this way on purpose: React takes "key"
   * for its own use, so a prop called key never reaches a component.
   */
  publishableKey?: string;
  baseUrl?: string;
  snapshot?: BrandSnapshot;
  storage?: StorageAdapter;
  appearance?: Appearance;
  remBase?: number;
  fonts?: FontPolicy;
  live?: LivePolicy;
  /**
   * Shown while there is nothing to paint with. Leave it out to render
   * the children straight away, which is the right choice when a
   * snapshot means the first frame is already branded.
   */
  fallback?: ReactNode;
  children: ReactNode;
}

function optionsFrom(props: DesignlessProviderProps): BrandOptions {
  return {
    publicId: props.publicId,
    publishableKey: props.publishableKey,
    baseUrl: props.baseUrl,
    snapshot: props.snapshot,
    storage: props.storage,
    appearance: props.appearance,
    remBase: props.remBase,
    fonts: props.fonts,
    live: props.live,
  };
}

export function DesignlessProvider(
  props: DesignlessProviderProps,
): ReactElement {
  const identity = props.publicId + "|" + (props.baseUrl || "");
  const brandRef = useRef<Brand | null>(null);
  const identityRef = useRef<string>(identity);
  const teardownRef = useRef<unknown>(null);
  const [, setTick] = useState(0);

  if (brandRef.current && identityRef.current !== identity) {
    brandRef.current.destroy();
    brandRef.current = null;
  }
  if (!brandRef.current) {
    identityRef.current = identity;
    brandRef.current = createBrand(optionsFrom(props));
  }
  const brand = brandRef.current;

  useEffect(() => {
    cancel(teardownRef.current);
    teardownRef.current = null;
    const stop = brand.subscribe(() => {
      setTick((value) => value + 1);
    });
    return (): void => {
      stop();
      teardownRef.current = later(() => {
        brand.destroy();
        if (brandRef.current === brand) brandRef.current = null;
      }, 0);
    };
  }, [brand]);

  const waiting = props.fallback !== undefined && brand.status === "cold";
  return createElement(
    BrandContext.Provider,
    { value: brand },
    waiting ? props.fallback : props.children,
  );
}
