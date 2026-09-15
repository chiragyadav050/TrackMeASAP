"use client";

import { usePathname } from "next/navigation";
import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { findNavItem } from "@/config/navigation";
import { routes, siteConfig } from "@/config/site";

/**
 * Location trail for the header.
 *
 * Phase 1 is one level deep everywhere, so the trail is
 * "Life OS → <surface>". The segment walk below already handles nesting, so
 * routes such as `/academics/subjects/[id]` will render correctly once they
 * exist without this component changing.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const current = findNavItem(pathname);

  if (!current) {
    return null;
  }

  // Segments below the matched nav item, e.g. ["subjects", "123"].
  const trailing = pathname
    .slice(current.href.length)
    .split("/")
    .filter(Boolean);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem className="hidden sm:block">
          <BreadcrumbLink href={routes.overview}>
            {siteConfig.name}
          </BreadcrumbLink>
        </BreadcrumbItem>

        <BreadcrumbSeparator className="hidden sm:block" />

        <BreadcrumbItem>
          {trailing.length === 0 ? (
            <BreadcrumbPage>{current.label}</BreadcrumbPage>
          ) : (
            <BreadcrumbLink href={current.href}>{current.label}</BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {trailing.map((segment, index) => {
          const isLast = index === trailing.length - 1;
          const href = `${current.href}/${trailing.slice(0, index + 1).join("/")}`;

          return (
            <Fragment key={href}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage className="capitalize">
                    {segment}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={href} className="capitalize">
                    {segment}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
