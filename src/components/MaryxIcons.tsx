"use client";

import { forwardRef, type ReactNode, type SVGProps } from "react";

export interface MaryxIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  title?: string;
}

/** MARYX Orbit: original 24-unit glyphs with open contours and translucent planes. */
function glyph(name: string, drawing: ReactNode) {
  const Icon = forwardRef<SVGSVGElement, MaryxIconProps>(function Icon({ size = 24, strokeWidth = 1.65, className = "", title, ...props }, ref) {
    return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title || props["aria-label"] ? undefined : true} focusable="false" className={`maryx-icon ${className}`} {...props}>
      {title && <title>{title}</title>}{drawing}
    </svg>;
  });
  Icon.displayName = `Maryx${name}`;
  return Icon;
}

export type MaryxIconType = ReturnType<typeof glyph>;
const plane = <rect x="3.5" y="4" width="17" height="16" rx="5" fill="currentColor" fillOpacity=".09" />;
const screen = <rect x="3" y="4" width="18" height="13" rx="3.5" fill="currentColor" fillOpacity=".08" />;

export const Sparkles = glyph("Intelligence", <><path d="M12 3.5c.7 5.3 3.2 7.8 8.5 8.5-5.3.7-7.8 3.2-8.5 8.5-.7-5.3-3.2-7.8-8.5-8.5 5.3-.7 7.8-3.2 8.5-8.5Z" fill="currentColor" fillOpacity=".13" /><path d="m18 3 .6 2.4L21 6l-2.4.6L18 9l-.6-2.4L15 6l2.4-.6Z" strokeWidth="1.2" /></>);
export const MessageSquare = glyph("Conversation", <><path d="M8 4h8c3 0 4.5 1.7 4.5 4.5v4.3c0 3-1.7 4.7-4.5 4.7h-6l-5.5 3v-5A4.7 4.7 0 0 1 3.5 12V8.5C3.5 5.7 5 4 8 4Z" fill="currentColor" fillOpacity=".09" /><path d="M8 9h8M8 12.5h4" /></>);
export const MessageSquarePlus = glyph("NewConversation", <><path d="M11 4H8C5 4 3.5 5.7 3.5 8.5V12c0 2 1 3.6 2 4.5v4l5-3H16c3 0 4.5-1.7 4.5-4.7V12" fill="currentColor" fillOpacity=".09" /><path d="M17.5 3v6M14.5 6h6M8 10h3M8 13h6" /></>);
export const Image = glyph("Image", <>{plane}<circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" /><path d="m4 16 5-5 8 8M13 15l3-3 4.5 4.5" /></>);
export const ImagePlus = glyph("AddImage", <><path d="M12 4H8C5 4 3.5 5.5 3.5 8v8c0 2.5 1.5 4 4 4h9c2.5 0 4-1.5 4-4v-4" fill="currentColor" fillOpacity=".09" /><path d="m4 16 5-5 8 8M15 6h7M18.5 2.5v7" /></>);
export const Clapperboard = glyph("Video", <><path d="M4 9h16v7.5c0 2.3-1.2 3.5-3.5 3.5h-9C5.2 20 4 18.8 4 16.5Z" fill="currentColor" fillOpacity=".1" /><path d="m4 9-1-4 16-3 1 4-16 3ZM8 4l3 3M14 3l3 3m-7 6 5 3-5 3Z" /></>);
export const Film = glyph("Film", <>{plane}<path d="M7 4v16M17 4v16M4 8h3M4 15h3M17 8h3M17 15h3m-10-5 4 2-4 2Z" /></>);
export const ScriptVideo = glyph("ScriptVideo", <><path d="M13 3H7C5 3 4 4 4 6v12c0 2 1 3 3 3h5M13 3l5 5h-5ZM8 9h2M8 13h4M8 17h2" fill="currentColor" fillOpacity=".09" /><path d="m17 12 5 3.5-5 3.5Z" fill="currentColor" fillOpacity=".15" /></>);
export const PhotoMotion = glyph("PhotoMotion", <><rect x="3" y="4" width="14" height="16" rx="4" fill="currentColor" fillOpacity=".09" /><circle cx="12.5" cy="8.5" r="1.2" /><path d="m3 16 5-5 6 7M19 7l3 3-3 3M19 16h3" /></>);
export const FrameTransition = glyph("FrameTransition", <><rect x="2" y="4" width="8" height="12" rx="2.5" fill="currentColor" fillOpacity=".09" /><rect x="14" y="8" width="8" height="12" rx="2.5" fill="currentColor" fillOpacity=".15" /><path d="M8 20h3a3 3 0 0 0 3-3M10 4h3a3 3 0 0 1 3 3M11 10l2 2-2 2" /></>);
export const VideoMagic = glyph("VideoMagic", <><rect x="2.5" y="5" width="19" height="15.5" rx="4" fill="currentColor" fillOpacity=".08" /><path d="m12 8 1.3 3.7L17 13l-3.7 1.3L12 18l-1.3-3.7L7 13l3.7-1.3ZM18 2v5M15.5 4.5h5" /></>);
export const Recast = glyph("Recast", <><rect x="2" y="4" width="8" height="14" rx="3" fill="currentColor" fillOpacity=".08" /><rect x="14" y="6" width="8" height="14" rx="3" fill="currentColor" fillOpacity=".15" /><circle cx="6" cy="9" r="1.5" /><circle cx="18" cy="11" r="1.5" /><path d="M4 15v-1a2 2 0 0 1 4 0v1M16 17v-1a2 2 0 0 1 4 0v1M11 3h4m-2-2 2 2-2 2M13 21H9m2-2-2 2 2 2" /></>);
export const Bot = glyph("Assistant", <><rect x="4" y="7" width="16" height="13" rx="5" fill="currentColor" fillOpacity=".12" /><path d="M12 7V3M10 3h4M8.5 12v1M15.5 12v1M9 16h6M1.5 12v4M22.5 12v4" /></>);
export const Brain = glyph("Reasoning", <><path d="M12 5c-2-3-6-1.5-6 2-4 1-4 6-1 7-1 4 3 7 7 4 4 3 8 0 7-4 3-1 3-6-1-7 0-3.5-4-5-6-2Z" fill="currentColor" fillOpacity=".12" /><path d="M12 5v13M6 7l2 2M5 14l3-1M18 7l-2 2M19 14l-3-1" /></>);
export const Settings = glyph("Preferences", <><path d="m12 2.8 2.5 2.5 3.5.2.7 3.4 2.3 2.6-2.3 2.7-.7 3.4-3.5.2-2.5 2.5-2.5-2.5-3.5-.2-.7-3.4L3 11.5l2.3-2.6L6 5.5l3.5-.2Z" fill="currentColor" fillOpacity=".09" /><circle cx="12" cy="11.5" r="3" /></>);
export const Gem = glyph("Membership", <><path d="m7 4 10 0 4 6-9 11-9-11 4-6Z" fill="currentColor" fillOpacity=".12" /><path d="M3 10h18M7 4l5 17 5-17M7 4l5 6 5-6" /></>);
export const Search = glyph("Search", <><circle cx="10.5" cy="10.5" r="6.5" fill="currentColor" fillOpacity=".08" /><path d="m15.5 15.5 5 5M7.5 10.5a3 3 0 0 1 3-3" /></>);
export const FileText = glyph("Document", <><path d="M14 3H8C5.5 3 4.5 4.2 4.5 6.5v11c0 2.3 1 3.5 3.5 3.5h8c2.5 0 3.5-1.2 3.5-3.5v-9L14 3Z" fill="currentColor" fillOpacity=".08" /><path d="M14 3v6h5.5M8.5 13h7M8.5 16.5H13" /></>);
export const Code2 = glyph("Code", <><path d="m7 6-5 6 5 6M17 6l5 6-5 6M14 3l-4 18" /><path d="m7 6-5 6 5 6M17 6l5 6-5 6" strokeWidth="3.4" opacity=".14" /></>);
export const Layers3 = glyph("Layers", <><path d="m12 3 10 5-10 5L2 8l10-5Z" fill="currentColor" fillOpacity=".12" /><path d="m3 13 9 4.5 9-4.5M3 17.5 12 22l9-4.5" /></>);
export const Globe = glyph("Languages", <><circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity=".08" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 6.5c4 2 10 2 14 0M5 17.5c4-2 10-2 14 0" /></>);
export const UserRound = glyph("Profile", <><circle cx="12" cy="7" r="4" fill="currentColor" fillOpacity=".12" /><path d="M4.5 21v-2.5c0-4 3-6 7.5-6s7.5 2 7.5 6V21" fill="currentColor" fillOpacity=".08" /></>);
export const UsersRound = glyph("Council", <><circle cx="9" cy="7.5" r="3.5" fill="currentColor" fillOpacity=".12" /><path d="M2 21v-3c0-3 2.5-5 7-5s7 2 7 5v3M16 4a3.5 3.5 0 0 1 0 7M18 14c2.5.4 4 2 4 4.5V21" /></>);
export const Palette = glyph("Colour", <><path d="M12 3a9 9 0 1 0 0 18c3 0 1-3 2-4.5s4 .5 6-2S22 3 12 3Z" fill="currentColor" fillOpacity=".1" /><path d="M7 9h.01M11 6.5h.01M16 8h.01M6.5 14h.01" strokeWidth="3" /></>);
export const Lightbulb = glyph("Idea", <><path d="M8.5 16c0-3-3-3.5-3-7a6.5 6.5 0 0 1 13 0c0 3.5-3 4-3 7Z" fill="currentColor" fillOpacity=".12" /><path d="M9 19h6M10.5 22h3M12 16v-5m-2-2 2 2 2-2" /></>);
export const AudioLines = glyph("Voice", <><path d="M3 10v4M7.5 6v12M12 3v18M16.5 7v10M21 10v4" /><path d="M12 3v18" strokeWidth="4" opacity=".15" /></>);
export const Mic = glyph("Microphone", <><rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor" fillOpacity=".12" /><path d="M5 11.5v1a7 7 0 0 0 14 0v-1M12 19.5V22M9 22h6" /></>);
export const Camera = glyph("Camera", <><path d="M7 6 9 3h6l2 3h2c2 0 3 1.2 3 3v8c0 2-1 3-3 3H5c-2 0-3-1-3-3V9c0-1.8 1-3 3-3Z" fill="currentColor" fillOpacity=".09" /><circle cx="12" cy="12.5" r="4" /><path d="M18 9h.01" strokeWidth="2.5" /></>);
export const SwitchCamera = glyph("SwitchCamera", <><path d="M18 5h1c2 0 3 1 3 3v9c0 2-1 3-3 3H5c-2 0-3-1-3-3V8c0-2 1-3 3-3h2M9 5l2-2h3l2 2" /><path d="M8 11a4.5 4.5 0 0 1 8 .5M16 15a4.5 4.5 0 0 1-8-.5M16 8.5v3h-3M8 17v-3h3" /></>);
export const Brush = glyph("Brush", <><path d="m11 14 8-11 2 2-8 11Z" fill="currentColor" fillOpacity=".12" /><path d="M11 14c-5-1-3 5-8 5 4 3 10 1 10-3" /></>);
export const Eraser = glyph("Erase", <><path d="m3 14 9-10c1-1 2-1 3 0l6 6c1 1 1 2 0 3l-7 8H9l-6-5c-.6-.5-.6-1.5 0-2Z" fill="currentColor" fillOpacity=".1" /><path d="m8 9 9 9M14 21h8" /></>);
export const WandSparkles = glyph("Transform", <><path d="m3 19 11-11 3 3L6 22Z" fill="currentColor" fillOpacity=".12" /><path d="m11 11 3 3M18 2v4M16 4h4M5 4v4M3 6h4M20 15v4M18 17h4" /></>);
export const Paperclip = glyph("Attachment", <path d="m8 13 7-7c4-4 9 1 5 5L10 21C4 26-2 18 3 13l9-9c3-3 7 1 4 4l-8 8c-1.5 1.5-3.5-.5-2-2l7-7" />);
export const Coins = glyph("Credits", <><ellipse cx="10" cy="7" rx="7" ry="3.5" fill="currentColor" fillOpacity=".12" /><path d="M3 7v5c0 5 14 5 14 0V7M3 11c0 4 14 4 14 0M20 10v7c0 3-7 5-12 3" /></>);
export const CreditCard = glyph("Payment", <><rect x="2.5" y="4.5" width="19" height="15" rx="4" fill="currentColor" fillOpacity=".1" /><path d="M3 10h18M7 15h4M16 15h1" /></>);
export const LockKeyhole = glyph("Private", <><rect x="4.5" y="10" width="15" height="11" rx="4" fill="currentColor" fillOpacity=".1" /><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3" /></>);
export const KeyRound = glyph("Key", <><circle cx="8.5" cy="8.5" r="5.5" fill="currentColor" fillOpacity=".12" /><path d="m12.5 12.5 8 8M16 16l2.5-2.5M19 19l2.5-2.5M7.5 7.5h.01" strokeWidth="1.8" /></>);
export const Eye = glyph("Preview", <><path d="M2 12c5-10 15-10 20 0-5 10-15 10-20 0Z" fill="currentColor" fillOpacity=".09" /><circle cx="12" cy="12" r="3" /></>);
export const AppWindow = glyph("Application", <>{plane}<path d="M4 9h16M7 6.5h.01M10 6.5h.01M8 13l-2 2 2 2M16 13l2 2-2 2" /></>);
export const Monitor = glyph("Desktop", <>{screen}<path d="M12 17v4M8 21h8" /></>);
export const MonitorUp = glyph("ScreenCapture", <>{screen}<path d="M12 14V7m-3 3 3-3 3 3M12 17v4M8 21h8" /></>);
export const Smartphone = glyph("Phone", <><rect x="6.5" y="2" width="11" height="20" rx="3.5" fill="currentColor" fillOpacity=".1" /><path d="M10 5h4M11 19h2" /></>);
export const Tablet = glyph("Tablet", <><rect x="4" y="2.5" width="16" height="19" rx="3.5" fill="currentColor" fillOpacity=".1" /><path d="M11 18.5h2" /></>);
export const Columns2 = glyph("Split", <>{plane}<path d="M12 4v16M7 9h2M15 9h2M7 13h2M15 13h2" /></>);
export const PanelLeftClose = glyph("Collapse", <>{plane}<path d="M9 4v16m7-12-4 4 4 4" /></>);
export const PanelLeftOpen = glyph("Expand", <>{plane}<path d="M9 4v16m4-12 4 4-4 4" /></>);
export const Presentation = glyph("Presentation", <><path d="M3 3h18M4.5 3v13h15V3M12 16v6m-4 0 4-4 4 4" /><path d="m8 11 3-3 2 2 3-4" /></>);
export const Gamepad2 = glyph("Playground", <><path d="M7 7h10c4 0 5 12 2 13-2 1-3-3-5-3h-4c-2 0-3 4-5 3-3-1-2-13 2-13Z" fill="currentColor" fillOpacity=".1" /><path d="M8 10v5M5.5 12.5h5M16 11h.01M18 14h.01" strokeWidth="1.8" /></>);
export const Compass = glyph("Explore", <><circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity=".07" /><path d="m16.5 7.5-3 6-6 3 3-6Z" fill="currentColor" fillOpacity=".18" /></>);
export const Telescope = glyph("Research", <><path d="m3 10 14-7 4 8-14 7-4-8ZM7 8l4 8M13 5l4 8M12 16v6m-4 0 4-6 4 6" fill="currentColor" fillOpacity=".07" /></>);
export const Volume2 = glyph("ReadAloud", <><path d="M3 9h4l6-5v16l-6-5H3Z" fill="currentColor" fillOpacity=".1" /><path d="M17 8c2 2 2 6 0 8M20 5c4 4 4 10 0 14" /></>);
export const Moon = glyph("Dark", <path d="M20.5 14.5A9.5 9.5 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z" fill="currentColor" fillOpacity=".12" />);
export const Sun = glyph("Light", <><circle cx="12" cy="12" r="4.5" fill="currentColor" fillOpacity=".15" /><path d="M12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2M4.5 4.5 6 6M18 18l1.5 1.5M4.5 19.5 6 18M18 6l1.5-1.5" /></>);
export const Type = glyph("Typography", <path d="M4 4h16M12 4v17M8 21h8M4 7V4M20 7V4" />);
export const FilePen = glyph("Write", <><path d="M12 3H8C5.5 3 4.5 4.2 4.5 6.5v11c0 2.3 1 3.5 3.5 3.5h8c2.5 0 3.5-1.2 3.5-3.5V14" fill="currentColor" fillOpacity=".08" /><path d="m12 13 8-9 2 2-8 9-3 1ZM8 18h7" /></>);
export const Pencil = glyph("Edit", <path d="m4 16 12-13 5 5L9 21H3Zm9-10 5 5M4 16l5 5" />);
export const PenLine = glyph("Editor", <><path d="m5 14 11-11 4 4L9 18H5Zm8-8 4 4M3 22h18" fill="currentColor" fillOpacity=".08" /></>);
export const Printer = glyph("Print", <><path d="M7 8V3h10v5M6 17H3V8h18v9h-3M7 14h10v7H7ZM17 11h1" /></>);
export const Copy = glyph("Copy", <><rect x="8" y="8" width="13" height="13" rx="3.5" fill="currentColor" fillOpacity=".1" /><path d="M16 5V3H6C4 3 3 4 3 6v10h2" /></>);
export const Download = glyph("Download", <><path d="M12 2v13m-5-5 5 5 5-5M3 16v3c0 2 1 3 3 3h12c2 0 3-1 3-3v-3" /><path d="M6 21h12" opacity=".35" strokeWidth="3" /></>);
export const Share2 = glyph("Share", <><circle cx="18" cy="5" r="3" fill="currentColor" fillOpacity=".12" /><circle cx="5" cy="12" r="3" fill="currentColor" fillOpacity=".12" /><circle cx="18" cy="19" r="3" fill="currentColor" fillOpacity=".12" /><path d="m8 10.5 7-4M8 13.5l7 4" /></>);
export const ExternalLink = glyph("OpenElsewhere", <><path d="M10 4H7C4 4 3 5 3 8v9c0 3 1 4 4 4h9c3 0 4-1 4-4v-3M14 3h7v7M11 13 21 3" /></>);
export const Trash2 = glyph("Delete", <><path d="M5 7h14l-1 13H6L5 7Z" fill="currentColor" fillOpacity=".08" /><path d="M3 7h18M8 7V3h8v4M9.5 11v5M14.5 11v5" /></>);
export const LogOut = glyph("SignOut", <><path d="M10 3H7C4 3 3 4 3 7v10c0 3 1 4 4 4h3M10 12h12m-5-5 5 5-5 5" /></>);
export const Info = glyph("Information", <><circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity=".1" /><path d="M12 11v6M12 7h.01" strokeWidth="2" /></>);
export const TriangleAlert = glyph("Notice", <><path d="M10 4c1-2 3-2 4 0l8 14c1 2 0 3-2 3H4c-2 0-3-1-2-3Z" fill="currentColor" fillOpacity=".12" /><path d="M12 8v6M12 17.5h.01" strokeWidth="1.9" /></>);
export const Circle = glyph("Status", <circle cx="12" cy="12" r="8.5" fill="currentColor" fillOpacity=".08" />);
export const CircleCheck = glyph("Complete", <><path d="M20.5 10A8.5 8.5 0 1 1 15 4" fill="currentColor" fillOpacity=".1" /><path d="m8 11 4 4 9-10" /></>);
export const Square = glyph("Stop", <rect x="5" y="5" width="14" height="14" rx="4" fill="currentColor" fillOpacity=".12" />);
export const Check = glyph("Confirm", <path d="m4.5 12 5 5 10-11" />);
export const X = glyph("Close", <path d="m6 6 12 12M18 6 6 18" />);
export const Plus = glyph("Add", <path d="M12 4v16M4 12h16" />);
export const Menu = glyph("Menu", <path d="M3 6h18M3 12h12M3 18h18" />);
export const Play = glyph("Play", <path d="M7 3.5v17l14-8.5L7 3.5Z" fill="currentColor" fillOpacity=".12" />);
export const Zap = glyph("Lite", <path d="m14 2-11 12h8l-1 8 11-12h-8Z" fill="currentColor" fillOpacity=".12" />);
export const ArrowUp = glyph("Send", <path d="M12 21V3m-7 7 7-7 7 7" />);
export const ArrowRight = glyph("Next", <path d="M3 12h18m-7-7 7 7-7 7" />);
export const ArrowUpRight = glyph("Discover", <path d="M5 19 19 5M6 5h13v13" />);
export const ChevronDown = glyph("ExpandList", <path d="m5 9 7 7 7-7" />);
export const ChevronLeft = glyph("Previous", <path d="m15 5-7 7 7 7" />);
export const ChevronRight = glyph("NextItem", <path d="m9 5 7 7-7 7" />);
export const CornerDownLeft = glyph("Enter", <path d="M21 4v6c0 3-1 4-4 4H3m5-5-5 5 5 5" />);
export const CornerDownRight = glyph("Reply", <path d="M3 4v6c0 3 1 4 4 4h14m-5-5 5 5-5 5" />);
export const Maximize2 = glyph("FullScreen", <path d="M3 9V3h6M15 21h6v-6M3 3l7 7M21 21l-7-7" />);
export const Minimize2 = glyph("Restore", <path d="M9 3v6H3M21 15h-6v6M9 9 2 2M15 15l7 7" />);
export const RotateCcw = glyph("Restart", <><path d="M4 9a8.5 8.5 0 1 1 .5 8M4 3v6h6" /></>);
export const Undo2 = glyph("Undo", <path d="M4 11h10c6 0 8 6 5 10M9 5l-6 6 6 6" />);
export const RefreshCw = glyph("Regenerate", <path d="M3 10a9 9 0 0 1 16-4l2 3M21 3v6h-6M21 14a9 9 0 0 1-16 4l-2-3M3 21v-6h6" />);
export const LoaderCircle = glyph("Loading", <><circle cx="12" cy="12" r="9" opacity=".16" /><path d="M12 3a9 9 0 0 1 9 9" /></>);
export const GraduationCap = glyph("Learning", <><path d="m2 8 10-5 10 5-10 5L2 8Z" fill="currentColor" fillOpacity=".12" /><path d="M6 10v7c4 3 8 3 12 0v-7M22 8v9" /></>);
export const Chart = glyph("Analysis", <><rect x="3" y="12" width="4" height="9" rx="1.5" fill="currentColor" fillOpacity=".15" /><rect x="10" y="7" width="4" height="14" rx="1.5" fill="currentColor" fillOpacity=".1" /><rect x="17" y="3" width="4" height="18" rx="1.5" fill="currentColor" fillOpacity=".07" /></>);
export const ChefHat = glyph("Cooking", <><path d="M7 14C1 14 1 5 7 5c1-4 9-4 10 0 6 0 6 9 0 9v7H7Z" fill="currentColor" fillOpacity=".1" /><path d="M7 17h10M10 10v3M14 10v3" /></>);
// Maps, scheduled tasks and the temporary chat.
export const MapPin = glyph("Place", <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" fill="currentColor" fillOpacity=".12" /><circle cx="12" cy="9.5" r="2.5" /></>);
export const MapIcon = glyph("Map", <><path d="m3 8 5-2 5 2 8-3v14l-8 3-5-2-5 2Z" fill="currentColor" fillOpacity=".09" /><path d="M8 12v8M13 13v9M17 5.5c0 3-4 6-4 6s-4-3-4-6a4 4 0 0 1 8 0Z" fill="currentColor" fillOpacity=".12" /><circle cx="13" cy="5.5" r="1" /></>);
export const Navigation = glyph("Route", <path d="m3.5 11 17-7.5-7.5 17-2-7.5Z" fill="currentColor" fillOpacity=".12" />);
export const LocateFixed = glyph("MyLocation", <><circle cx="12" cy="12" r="6.5" fill="currentColor" fillOpacity=".08" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" /></>);
export const Clock = glyph("Time", <><circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity=".09" /><path d="M12 7v5l3.5 2" /></>);
export const CalendarClock = glyph("Scheduled", <><path d="M11 19.5H7.5C5 19.5 3.5 18 3.5 15.5v-7C3.5 6 5 4.5 7.5 4.5h7c2.5 0 4 1.5 4 4V11" fill="currentColor" fillOpacity=".09" /><path d="M7.5 2.5v4M14.5 2.5v4M3.5 9.5h15" /><circle cx="17" cy="17" r="4.5" /><path d="M17 15v2.2l1.4 1" /></>);
export const CalendarDays = glyph("Calendar", <><rect x="3" y="4.5" width="18" height="17" rx="4" fill="currentColor" fillOpacity=".09" /><path d="M7.5 2v5M16.5 2v5M3 10h18M7 14h1M12 14h1M17 14h.01M7 18h1M12 18h1" /></>);
export const Repeat2 = glyph("Routine", <><path d="M3 9V7a3 3 0 0 1 3-3h13m-4-3 4 3-4 3M21 15v2a3 3 0 0 1-3 3H5m4-3-4 3 4 3" /><circle cx="12" cy="12" r="3.5" fill="currentColor" fillOpacity=".12" /><path d="M12 10v2l1.3.8" /></>);
export const ShieldCheck = glyph("Privacy", <><path d="M12 2.5 21 6v5c0 6-9 11-9 11S3 17 3 11V6Z" fill="currentColor" fillOpacity=".09" /><path d="m8 11.5 3 3 5-6" /></>);
export const Ghost = glyph("Temporary", <><path d="M5 20.5V11a7 7 0 0 1 14 0v9.5l-2.4-1.8-2.3 1.8-2.3-1.8-2.3 1.8-2.3-1.8Z" fill="currentColor" fillOpacity=".1" /><path d="M9.5 11h.01M14.5 11h.01" strokeWidth="2.4" /></>);
export const Pause = glyph("Pause", <><rect x="6" y="5" width="4" height="14" rx="1.5" fill="currentColor" fillOpacity=".12" /><rect x="14" y="5" width="4" height="14" rx="1.5" fill="currentColor" fillOpacity=".12" /></>);
export const Bell = glyph("Notice", <><path d="M6 10a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 15 6 10Z" fill="currentColor" fillOpacity=".1" /><path d="M10 20a2.2 2.2 0 0 0 4 0" /></>);
export const Phone = glyph("Call", <path d="M5 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 12l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 3 5a2 2 0 0 1 2-2Z" fill="currentColor" fillOpacity=".1" />);
export const Coffee = glyph("Cafe", <><path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z" fill="currentColor" fillOpacity=".12" /><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3c-1 1.5 1 2.5 0 4M12 3c-1 1.5 1 2.5 0 4M3 21.5h14" /></>);
export const Utensils = glyph("Restaurant", <path d="M6 2.5v6a2.5 2.5 0 0 0 5 0v-6M8.5 2.5v19M17 21.5V2.5c-2.5 1-3.5 4-3.5 7.5 0 2 1 3 3.5 3" />);
export const Pill = glyph("Pharmacy", <><rect x="2.8" y="8.2" width="18.4" height="7.6" rx="3.8" transform="rotate(-45 12 12)" fill="currentColor" fillOpacity=".12" /><path d="m9 9 6 6" /></>);
export const Banknote = glyph("Cash", <><rect x="2.5" y="6" width="19" height="12" rx="3.5" fill="currentColor" fillOpacity=".1" /><circle cx="12" cy="12" r="2.6" /><path d="M6 9.5h.01M18 14.5h.01" strokeWidth="2.4" /></>);
export const ShoppingCart = glyph("Shop", <><path d="M3 3.5h2.5l2.3 11h10.4l2.3-8H7" fill="currentColor" fillOpacity=".09" /><circle cx="9" cy="19.5" r="1.5" /><circle cx="17" cy="19.5" r="1.5" /></>);
export const Fuel = glyph("Fuel", <><rect x="4" y="3.5" width="10" height="17" rx="2.5" fill="currentColor" fillOpacity=".1" /><path d="M4 10h10M14 8l3.5 3v6.5a1.5 1.5 0 0 0 3 0V8L17 5M2.5 20.5h13" /></>);
export const BedDouble = glyph("Hotel", <><path d="M3 18v-5.5A2.5 2.5 0 0 1 5.5 10h13a2.5 2.5 0 0 1 2.5 2.5V18Z" fill="currentColor" fillOpacity=".1" /><path d="M3 18v3M21 18v3M5 10V6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5V10M12 4v6" /></>);
export const Landmark = glyph("Museum", <><path d="m12 2.5 9 5H3Z" fill="currentColor" fillOpacity=".12" /><path d="M5 10.5v7M9.7 10.5v7M14.3 10.5v7M19 10.5v7M3 21h18M4 18h16" /></>);
export const Trees = glyph("Park", <><path d="M9 3 3.5 13h11Z" fill="currentColor" fillOpacity=".12" /><path d="M9 13v8M15.5 8a4.5 4.5 0 0 1 4.5 4.5c0 3-2 4.5-4.5 4.5M17 17v4M2 21h20" /></>);
export const Wine = glyph("Bar", <><path d="M7 2.5h10l-.5 5.5a4.5 4.5 0 0 1-9 0Z" fill="currentColor" fillOpacity=".12" /><path d="M12 12.5v8.5M8 21h8" /></>);

const PERSONAS: Record<string, MaryxIconType> = { "👨‍💻": Code2, "💻": Code2, "🌍": Globe, "🌐": Globe, "✍️": PenLine, "🇬🇧": GraduationCap, "🎓": GraduationCap, "📊": Chart, "👨‍🍳": ChefHat, "🤖": Bot };
export function PersonaSymbol({ emoji, className = "" }: { emoji: string; className?: string }) {
  const Icon = PERSONAS[emoji];
  return Icon ? <Icon className={`persona-symbol ${className}`} /> : <span className={className}>{emoji}</span>;
}

const EFFECTS: Record<string, MaryxIconType> = { "✨": Sparkles, "🔍": Search, "📸": Camera, "🎬": Clapperboard, "🏞️": Image, "💼": UserRound, "🌸": Sparkles, "🧸": Bot, "📼": Film, "🖤": Circle, "🌃": Zap, "🎨": Palette, "🎯": Compass, "🔭": Telescope, "🔄": RotateCcw, "🚁": Compass, "💥": Zap, "🏃": ArrowRight, "🎥": Camera, "🐢": Play, "📌": Circle, "📷": Camera, "💧": Brush, "👾": Gamepad2, "◻️": Square, "🔷": Gem, "📰": FileText, "🗼": Globe, "🏝️": Sun, "🚀": ArrowUpRight, "🦸": Zap, "⚔️": Gem, "🕵️": Eye, "🎄": Sparkles, "🧽": Eraser, "🎩": UserRound, "✂️": PenLine, "📖": FileText, "✅": Check, "🧒": Lightbulb, "👔": UserRound, "😊": MessageSquare, "🎉": Sparkles, "🇬🇧": Globe };
export function EffectSymbol({ emoji, className = "" }: { emoji: string; className?: string }) {
  const Icon = EFFECTS[emoji] ?? Sparkles;
  return <Icon className={`effect-symbol ${className}`} />;
}
export const Puzzle = glyph("Plugins", <><path d="M9 4.5a2 2 0 1 1 4 0V6h3.5A1.5 1.5 0 0 1 18 7.5V11h1.5a2 2 0 1 1 0 4H18v3.5a1.5 1.5 0 0 1-1.5 1.5H13v-1.5a2 2 0 1 0-4 0V20H5.5A1.5 1.5 0 0 1 4 18.5V15h1.5a2 2 0 1 0 0-4H4V7.5A1.5 1.5 0 0 1 5.5 6H9Z" fill="currentColor" fillOpacity=".1" /></>);
