"use client";

import { useClerk } from "@clerk/nextjs";
import { LogOut, Settings, User } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { routes } from "@/config/site";
import type { ProfileDto } from "@/types/profile";

type UserMenuProps = {
  /** Only the serialisable fields the menu actually renders. */
  readonly profile: Pick<
    ProfileDto,
    "displayName" | "email" | "avatarUrl" | "timeZone"
  >;
};

export function UserMenu({ profile }: UserMenuProps) {
  const { signOut } = useClerk();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = useCallback(() => {
    setIsSigningOut(true);
    // Clerk clears the session and performs the redirect itself; if it throws,
    // re-enable the control rather than leaving a dead menu item.
    void signOut({ redirectUrl: routes.home }).catch(() => {
      setIsSigningOut(false);
    });
  }, [signOut]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Account menu for ${profile.displayName}`}
          >
            <UserAvatar profile={profile} />
          </Button>
        }
      />

      <DropdownMenuContent align="end" className="w-60">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <UserAvatar profile={profile} className="size-8" />

          <div className="min-w-0">
            <p className="truncate text-meta font-medium">
              {profile.displayName}
            </p>
            <p className="truncate text-label text-muted-foreground">
              {profile.email ?? profile.timeZone}
            </p>
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          render={
            <Link href={routes.settings}>
              <Settings className="size-4 text-muted-foreground" />
              Settings
            </Link>
          }
        />

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleSignOut} disabled={isSigningOut}>
          <LogOut className="size-4 text-muted-foreground" />
          {isSigningOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserAvatar({
  profile,
  className,
}: {
  profile: UserMenuProps["profile"];
  className?: string;
}) {
  return (
    <Avatar className={className ?? "size-6"}>
      {profile.avatarUrl ? (
        <AvatarImage src={profile.avatarUrl} alt="" />
      ) : null}
      <AvatarFallback className="text-label">
        {getInitials(profile.displayName)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Up to two initials; falls back to a neutral glyph for unusable names. */
function getInitials(displayName: string): React.ReactNode {
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || <User className="size-3.5" aria-hidden />;
}
