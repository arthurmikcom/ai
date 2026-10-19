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
