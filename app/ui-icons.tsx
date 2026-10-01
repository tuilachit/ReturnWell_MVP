import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from "@hugeicons/react";
import MedicalFile from "@hugeicons/core-free-icons/MedicalFileIcon";
import UserGroup from "@hugeicons/core-free-icons/UserGroupIcon";
import Calendar02 from "@hugeicons/core-free-icons/Calendar02Icon";
import AlertCircle from "@hugeicons/core-free-icons/AlertCircleIcon";
import BookOpen01 from "@hugeicons/core-free-icons/BookOpen01Icon";
import NoteEdit from "@hugeicons/core-free-icons/NoteEditIcon";
import Hospital01 from "@hugeicons/core-free-icons/Hospital01Icon";
import ArrowLeft02 from "@hugeicons/core-free-icons/ArrowLeft02Icon";
import ArrowRight02 from "@hugeicons/core-free-icons/ArrowRight02Icon";
import ArrowUpRight01 from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import ArrowLeft01 from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01 from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowDown01 from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Tick02 from "@hugeicons/core-free-icons/Tick02Icon";
import Clock01 from "@hugeicons/core-free-icons/Clock01Icon";
import TestTube01 from "@hugeicons/core-free-icons/TestTube01Icon";
import Lock from "@hugeicons/core-free-icons/LockIcon";
import Logout02 from "@hugeicons/core-free-icons/Logout02Icon";
import MenuTwoLine from "@hugeicons/core-free-icons/MenuTwoLineIcon";
import RefreshCwData from "@hugeicons/core-free-icons/RefreshCwIcon";
import Cancel01 from "@hugeicons/core-free-icons/Cancel01Icon";
import Search01 from "@hugeicons/core-free-icons/Search01Icon";
import FilterHorizontal from "@hugeicons/core-free-icons/FilterHorizontalIcon";
import Mail02 from "@hugeicons/core-free-icons/Mail02Icon";
import Location01 from "@hugeicons/core-free-icons/Location01Icon";
import Video01 from "@hugeicons/core-free-icons/Video01Icon";
import Sent02 from "@hugeicons/core-free-icons/Sent02Icon";
import LinkSquare02 from "@hugeicons/core-free-icons/LinkSquare02Icon";

type IconProps = Omit<HugeiconsIconProps, "icon">;

/** One rounded stroke family. Accessible names belong on the labelled controls. */
function createIcon(icon: IconSvgElement) {
  return function Icon({
    size = 22,
    strokeWidth = 1.5,
    className,
    ...props
  }: IconProps) {
    return (
      <HugeiconsIcon
        icon={icon}
        size={size}
        strokeWidth={strokeWidth}
        color="currentColor"
        aria-hidden="true"
        focusable="false"
        className={["rw-icon", className].filter(Boolean).join(" ")}
        {...props}
      />
    );
  };
}

export const ReferralIcon = createIcon(MedicalFile);
export const PeopleIcon = createIcon(UserGroup);
export const CalendarIcon = createIcon(Calendar02);
export const AttentionIcon = createIcon(AlertCircle);
export const GuideIcon = createIcon(BookOpen01);
export const ComposeIcon = createIcon(NoteEdit);
export const PracticeIcon = createIcon(Hospital01);
export const ArrowLeft = createIcon(ArrowLeft02);
export const ArrowRight = createIcon(ArrowRight02);
export const ArrowUpRight = createIcon(ArrowUpRight01);
export const ChevronLeft = createIcon(ArrowLeft01);
export const ChevronRight = createIcon(ArrowRight01);
export const ChevronDown = createIcon(ArrowDown01);
export const Check = createIcon(Tick02);
export const CircleAlert = AttentionIcon;
export const Clock3 = createIcon(Clock01);
export const FlaskConical = createIcon(TestTube01);
export const LockKeyhole = createIcon(Lock);
export const LogOut = createIcon(Logout02);
export const Menu = createIcon(MenuTwoLine);
export const RefreshCw = createIcon(RefreshCwData);
export const X = createIcon(Cancel01);
export const Search = createIcon(Search01);
export const SlidersHorizontal = createIcon(FilterHorizontal);
export const Mail = createIcon(Mail02);
export const MapPin = createIcon(Location01);
export const Video = createIcon(Video01);
export const Send = createIcon(Sent02);
export const ExternalLink = createIcon(LinkSquare02);
