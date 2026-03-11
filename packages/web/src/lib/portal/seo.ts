import { useEffect } from "react";

interface PortalMetaOptions {
  title: string;
  description: string;
  canonicalUrl?: string;
  ogType?: string;
  ogImage?: string | null;
  siteName?: string;
}

/**
 * Set portal page meta tags. Returns a cleanup function that
 * removes the added tags (for use in useEffect cleanup).
 */
export function setPortalMeta(options: PortalMetaOptions): () => void {
  const { title, description, canonicalUrl, ogType = "website", ogImage, siteName } = options;

  // Set document title
  const prevTitle = document.title;
  document.title = title;

  // Track added elements for cleanup
  const addedElements: Element[] = [];

  function setMeta(property: string, content: string, isName = false) {
    const attr = isName ? "name" : "property";
    // Try to find existing tag
    let tag = document.head.querySelector(`meta[${attr}="${property}"]`);
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute(attr, property);
      document.head.appendChild(tag);
      addedElements.push(tag);
    }
    tag.setAttribute("content", content);
  }

  // Standard meta
  setMeta("description", description, true);

  // Open Graph
  setMeta("og:title", title);
  setMeta("og:description", description);
  setMeta("og:type", ogType);
  if (siteName) setMeta("og:site_name", siteName);
  if (canonicalUrl) setMeta("og:url", canonicalUrl);
  if (ogImage) setMeta("og:image", ogImage);

  // Twitter Card
  setMeta("twitter:card", "summary", true);
  setMeta("twitter:title", title, true);
  setMeta("twitter:description", description, true);

  // Canonical link
  let canonicalLink = document.head.querySelector('link[rel="canonical"]');
  if (canonicalUrl) {
    if (!canonicalLink) {
      canonicalLink = document.createElement("link");
      canonicalLink.setAttribute("rel", "canonical");
      document.head.appendChild(canonicalLink);
      addedElements.push(canonicalLink);
    }
    canonicalLink.setAttribute("href", canonicalUrl);
  }

  // Cleanup function
  return () => {
    document.title = prevTitle;
    addedElements.forEach((el) => el.remove());
  };
}

export function usePortalMeta(options: PortalMetaOptions | null) {
  useEffect(() => {
    if (!options) return;
    return setPortalMeta(options);
  }, [options?.title, options?.description, options?.canonicalUrl]);
}
