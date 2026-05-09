import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Search, Globe, Star, Clock, Heart, ChevronLeft,
  ChevronRight, RotateCcw, Eye, Plus, X, ChevronDown, ImageOff, Loader2,
  MoreVertical, Pencil, Copy, Trash2, Info,
} from "lucide-react";
import { cn } from "../components/ui/utils";
import { getTemplates, createTemplate, resolveTemplatePreview, type TemplateRecord } from "../../lib/templateApi";
import { subscribeToTemplateUpdates } from "../../lib/realtime";
import { DESIGNER_CONTEXT_KEY } from "../../lib/fabricUtils";
import { toast } from "sonner";

// ─── Constants ────────────────────────────────────────────────────────────────

type TabType = "all" | "recommended" | "recent" | "favorites";
type OrientationType = "all" | "portrait" | "landscape";
const ITEMS_PER_PAGE = 12;

const SIDEBAR_CATEGORIES = [
  { label: "All Categories", value: "all" },
  { label: "School ID",      value: "School ID" },
  { label: "Corporate ID",   value: "Corporate ID" },
  { label: "Event ID",       value: "Event ID" },
  { label: "Membership",     value: "Membership" },
  { label: "Other",          value: "Other" },
];

const SIDEBAR_SIZES = [
  { label: "All Sizes", value: "all" },
  { label: "58×89mm",   value: "58x89mm" },
  { label: "54×86mm",   value: "54x86mm" },
  { label: "A4",        value: "A4" },
  { label: "A5",        value: "A5" },
  { label: "Custom",    value: "custom" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deriveDisplayCategory(t: TemplateRecord): string {
  const cat  = (t.category || "").toLowerCase();
  const tags = (t.tags || []).map((x) => x.toLowerCase());
  if (cat.includes("school") || tags.some((x) => x.includes("school")))          return "School ID";
  if (cat.includes("event")  || cat === "festival" || tags.some((x) => x.includes("event"))) return "Event ID";
  if (cat === "membership"   || cat === "wedding"  || tags.some((x) => x.includes("member"))) return "Membership";
  if (cat.includes("corporate") || cat === "business" || tags.some((x) => x.includes("corporate"))) return "Corporate ID";
  return "Other";
}

function deriveSize(t: TemplateRecord): string {
  const dd = t.designData as Record<string, unknown> | undefined;
  if (dd) {
    const w = (dd.width ?? dd.canvasWidth) as number | undefined;
    const h = (dd.height ?? dd.canvasHeight) as number | undefined;
    if (w && h) {
      const wmm = Math.round((w * 25.4) / 96);
      const hmm = Math.round((h * 25.4) / 96);
      return `${wmm}×${hmm}mm`;
    }
  }
  for (const tag of t.tags ?? []) {
    if (/^\d+[x×]\d+mm$/i.test(tag)) return tag.replace("x", "×");
    if (tag === "A4" || tag === "A5")  return tag;
  }
  return "58×89mm";
}

function deriveSizeKey(t: TemplateRecord): string {
  return deriveSize(t).replace("×", "x").toLowerCase();
}

function deriveOrientation(t: TemplateRecord): "portrait" | "landscape" {
  const dd = t.designData as Record<string, unknown> | undefined;
  if (dd) {
    const w = ((dd.width ?? dd.canvasWidth ?? 0) as number);
    const h = ((dd.height ?? dd.canvasHeight ?? 0) as number);
    if (w && h) return w > h ? "landscape" : "portrait";
  }
  return "portrait";
}

function toggleCheckbox(
  value: string,
  current: string[],
  allValues: string[],
): string[] {
  if (value === "all") return ["all"];
  let next = current.filter((x) => x !== "all");
  next = next.includes(value) ? next.filter((x) => x !== value) : [...next, value];
  return next.length === 0 || next.length === allValues.length - 1 ? ["all"] : next;
}

// ─── TemplateCard ─────────────────────────────────────────────────────────────

interface TemplateCardProps {
  template: TemplateRecord;
  onUse: (t: TemplateRecord) => void;
  onPreview: (t: TemplateRecord) => void;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  projectId?: string | null;
  isAttaching?: boolean;
  onDuplicate: (t: TemplateRecord) => void;
  onDelete: (t: TemplateRecord) => void;
  isDuplicating?: boolean;
}

function TemplateCard({
  template: t, onUse, onPreview, isFavorite, onToggleFavorite,
  projectId, isAttaching, onDuplicate, onDelete, isDuplicating,
}: TemplateCardProps) {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const previewSrc = resolveTemplatePreview(t);
  const displayCategory = deriveDisplayCategory(t);
  const size = deriveSize(t);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div ref={menuRef} className="group relative flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
      {/* Thumbnail — overflow-hidden only clips image, NOT the dropdown */}
      <div className="relative h-40 bg-gray-100 overflow-hidden rounded-t-xl">
        {previewSrc && !imgError ? (
          <img
            src={previewSrc}
            alt={t.templateName}
            className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-105"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-400">
            <ImageOff className="h-8 w-8" />
            <span className="text-xs">No Preview Available</span>
          </div>
        )}

        {/* Public badge */}
        <div className="absolute left-2 top-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-gray-700 shadow-sm">
            <Globe className="h-3 w-3 text-blue-500" />
            Public
          </span>
        </div>

        {/* Favorite + three-dot trigger — buttons only, NO dropdown panel here */}
        <div className="absolute right-2 top-2 flex items-center gap-1">
          <button
            onClick={() => onToggleFavorite(t._id)}
            title={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
            className={cn(
              "rounded-full bg-white/90 p-1 shadow-sm hover:bg-white transition-colors",
              isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <Star className={cn("h-3.5 w-3.5", isFavorite ? "fill-yellow-400 text-yellow-400" : "text-gray-400")} />
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
            title="More options"
            className={cn(
              "rounded-full bg-white/90 p-1 shadow-sm hover:bg-white transition-colors text-gray-500",
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/*
        ── Dropdown panel is a direct child of the card's outer `relative` div,
           completely outside the thumbnail's `overflow-hidden` scope.
           Positioned from the card top-right corner.
      */}
      {menuOpen && (
        <div className="absolute right-2 top-9 z-[100] min-w-[185px] rounded-xl border border-gray-200 bg-white py-1 shadow-2xl">
          <button
            onClick={() => {
              setMenuOpen(false);
              localStorage.setItem(DESIGNER_CONTEXT_KEY, JSON.stringify({
                projectId: t.productId || "",
                templateId: t._id,
                templateName: t.templateName,
              }));
              navigate(`/designer-studio?templateId=${t._id}`);
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5 text-gray-400" /> Edit Template
          </button>
          <button
            onClick={() => { setMenuOpen(false); onDuplicate(t); }}
            disabled={isDuplicating}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {isDuplicating
              ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
              : <Copy className="h-3.5 w-3.5 text-gray-400" />}
            {isDuplicating ? "Duplicating…" : "Duplicate Template"}
          </button>
          <button
            onClick={() => { setMenuOpen(false); onToggleFavorite(t._id); }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Star className={cn("h-3.5 w-3.5", isFavorite ? "fill-yellow-400 text-yellow-400" : "text-gray-400")} />
            {isFavorite ? "Remove from Favorites" : "Add to Favorites"}
          </button>
          <button
            onClick={() => { setMenuOpen(false); onPreview(t); }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Info className="h-3.5 w-3.5 text-gray-400" /> View Details
          </button>
          <div className="my-1 border-t border-gray-100" />
          <button
            onClick={() => { setMenuOpen(false); onDelete(t); }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete Template
          </button>
        </div>
      )}

      {/* Card body */}
      <div className="flex flex-col gap-3 p-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 line-clamp-1">{t.templateName}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{size} • {displayCategory}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onUse(t)}
            disabled={isAttaching}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isAttaching
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Attaching…</>
              : projectId
                ? <><Plus className="h-3.5 w-3.5" /> Attach to Project</>
                : <><Plus className="h-3.5 w-3.5" /> Use Template</>
            }
          </button>
          <button
            onClick={() => onPreview(t)}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Eye className="h-3.5 w-3.5" /> Preview
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({
  template, onConfirm, onCancel, isDeleting,
}: {
  template: TemplateRecord;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
            <Trash2 className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Delete Template</h3>
            <p className="mt-1 text-sm text-gray-500">
              Are you sure you want to delete{" "}
              <strong className="font-medium text-gray-700">"{template.templateName}"</strong>?{" "}
              This action cannot be undone.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {isDeleting
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…</>
              : <><Trash2 className="h-3.5 w-3.5" /> Delete</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Preview Modal ────────────────────────────────────────────────────────────

function PreviewModal({ template, onClose }: { template: TemplateRecord; onClose: () => void }) {
  const previewSrc = resolveTemplatePreview(template);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-lg bg-white rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-gray-900">{template.templateName}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6 bg-gray-50 min-h-56 flex items-center justify-center">
          {previewSrc ? (
            <img src={previewSrc} alt={template.templateName} className="max-h-96 max-w-full object-contain rounded-lg shadow" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-gray-400">
              <ImageOff className="h-12 w-12" />
              <p className="text-sm">No preview available</p>
            </div>
          )}
        </div>
        <div className="flex gap-3 px-5 py-4 border-t bg-white">
          <p className="text-xs text-gray-500 self-center flex-1">{deriveSize(template)} • {deriveDisplayCategory(template)}</p>
          <button onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton Card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden animate-pulse">
      <div className="h-40 bg-gray-200" />
      <div className="p-3 space-y-2">
        <div className="h-4 w-3/4 rounded bg-gray-200" />
        <div className="h-3 w-1/2 rounded bg-gray-200" />
        <div className="flex gap-2 pt-1">
          <div className="h-7 flex-1 rounded-lg bg-gray-200" />
          <div className="h-7 flex-1 rounded-lg bg-gray-200" />
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function TemplateGallery() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("projectId");

  const [templates, setTemplates]   = useState<TemplateRecord[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const realtimeRefreshRef = useRef<number | null>(null);
  const lastFetchTimeRef   = useRef<number>(0);
  const pollingIntervalRef = useRef<number | null>(null);

  // Sidebar filters
  const [selectedCategories, setSelectedCategories] = useState<string[]>(["all"]);
  const [selectedSizes, setSelectedSizes]           = useState<string[]>(["all"]);
  const [orientation, setOrientation]               = useState<OrientationType>("all");

  // Top-bar filters
  const [query, setQuery]                         = useState("");
  const [dropdownSize, setDropdownSize]           = useState("all");
  const [dropdownCategory, setDropdownCategory]   = useState("all");
  const [dropdownOrientation, setDropdownOrientation] = useState("all");

  const [activeTab, setActiveTab]       = useState<TabType>("all");
  const [currentPage, setCurrentPage]   = useState(1);
  const [previewTemplate, setPreviewTemplate] = useState<TemplateRecord | null>(null);

  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("tg_favorites") ?? "[]") as string[]; } catch { return []; }
  });
  const [recentlyUsed, setRecentlyUsed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("tg_recent") ?? "[]") as string[]; } catch { return []; }
  });
  const [attachingTemplateId, setAttachingTemplateId]     = useState<string | null>(null);
  const [duplicatingTemplateId, setDuplicatingTemplateId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget]                   = useState<TemplateRecord | null>(null);
  const [isDeleting, setIsDeleting]                       = useState(false);

  const fetchTemplates = useCallback(() => {
    // Prevent overlapping concurrent fetches (e.g. SSE + polling both firing at once).
    const now = Date.now();
    if (now - lastFetchTimeRef.current < 500) return;
    lastFetchTimeRef.current = now;

    setLoading(true);
    setError("");
    getTemplates()
      .then((data) => {
        // Deduplicate: skip any template whose name (case-insensitive) or _id was already seen.
        // Also exclude "(Copy)" templates — those are project-local clones, not gallery items.
        const seenIds   = new Set<string>();
        const seenNames = new Set<string>();
        const unique = data.filter((t) => {
          if (seenIds.has(t._id)) return false;
          seenIds.add(t._id);
          const nameKey = t.templateName.trim().toLowerCase();
          if (seenNames.has(nameKey)) return false;
          seenNames.add(nameKey);
          // Hide project-local copy templates from the global gallery
          if (/\(copy\)/i.test(t.templateName)) return false;
          return true;
        });
        setTemplates(unique);
        setError("");
      })
      .catch((err) => setError((err as Error).message ?? "Failed to load templates"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // SSE real-time updates: refresh gallery when templates change on the server.
  useEffect(() => {
    const unsubscribe = subscribeToTemplateUpdates(undefined, () => {
      if (realtimeRefreshRef.current) return;
      realtimeRefreshRef.current = window.setTimeout(() => {
        realtimeRefreshRef.current = null;
        fetchTemplates();
      }, 300);
    });

    return () => {
      if (realtimeRefreshRef.current) {
        window.clearTimeout(realtimeRefreshRef.current);
        realtimeRefreshRef.current = null;
      }
      unsubscribe();
    };
  }, [fetchTemplates]);

  // Polling fallback: refresh every 30 seconds in case SSE is unavailable in production
  // (e.g. Render's HTTP proxy drops long-lived connections).
  useEffect(() => {
    pollingIntervalRef.current = window.setInterval(() => {
      // Only poll when the tab is visible to avoid unnecessary requests while backgrounded.
      if (document.visibilityState === 'visible') {
        fetchTemplates();
      }
    }, 30_000);

    return () => {
      if (pollingIntervalRef.current !== null) {
        window.clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [fetchTemplates]);

  useEffect(() => { localStorage.setItem("tg_favorites", JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem("tg_recent", JSON.stringify(recentlyUsed)); }, [recentlyUsed]);

  const activeTemplates = useMemo(() => templates.filter((t) => t.isActive !== false), [templates]);

  const applyFilters = useCallback((list: TemplateRecord[]) => {
    const effSizes    = dropdownSize     !== "all" ? [dropdownSize]     : selectedSizes;
    const effCats     = dropdownCategory !== "all" ? [dropdownCategory] : selectedCategories;
    const effOrient   = dropdownOrientation !== "all" ? dropdownOrientation as OrientationType : orientation;

    return list.filter((t) => {
      if (query.trim()) {
        const hay = [t.templateName, t.category, ...(t.tags ?? []), deriveDisplayCategory(t)].join(" ").toLowerCase();
        if (!hay.includes(query.trim().toLowerCase())) return false;
      }
      if (!effCats.includes("all")) {
        if (!effCats.includes(deriveDisplayCategory(t))) return false;
      }
      if (!effSizes.includes("all")) {
        if (!effSizes.some((s) => s.toLowerCase() === deriveSizeKey(t))) return false;
      }
      if (effOrient !== "all" && deriveOrientation(t) !== effOrient) return false;
      return true;
    });
  }, [query, selectedCategories, selectedSizes, orientation, dropdownSize, dropdownCategory, dropdownOrientation]);

  const tabFiltered = useMemo(() => {
    let list = activeTemplates;
    if (activeTab === "recommended") list = list.slice(0, 8);
    else if (activeTab === "favorites") list = list.filter((t) => favorites.includes(t._id));
    else if (activeTab === "recent") { const s = new Set(recentlyUsed); list = list.filter((t) => s.has(t._id)); }
    return applyFilters(list);
  }, [activeTemplates, activeTab, favorites, recentlyUsed, applyFilters]);

  const recommended = useMemo(() => applyFilters(activeTemplates).slice(0, 6), [activeTemplates, applyFilters]);

  const totalPages     = Math.max(1, Math.ceil(tabFiltered.length / ITEMS_PER_PAGE));
  const pagedTemplates = tabFiltered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Reset page on filter change
  useEffect(() => { setCurrentPage(1); },
    [query, selectedCategories, selectedSizes, orientation, activeTab, dropdownSize, dropdownCategory, dropdownOrientation]);

  const handleUseTemplate = async (t: TemplateRecord) => {
    if (projectId) {
      // Attach mode: clone the global template into the project
      setAttachingTemplateId(t._id);
      try {
        const result = await createTemplate({
          productId: projectId,
          projectId: projectId,
          templateName: t.templateName,
          preview_image: resolveTemplatePreview(t),
          category: (t.category as any) || "Other",
          designData: t.designData ?? {},
          isGlobal: false,
          isPublic: false,
        }) as any;
        setRecentlyUsed((prev) => [t._id, ...prev.filter((id) => id !== t._id)].slice(0, 20));
        if (result?.alreadyExists) {
          toast.info(`"${t.templateName}" is already attached to this project.`);
        } else {
          toast.success(`"${t.templateName}" attached to project.`);
        }
        navigate(`/projects/${projectId}?tab=templates`);
      } catch (err) {
        toast.error((err as Error).message || "Failed to attach template to project.");
      } finally {
        setAttachingTemplateId(null);
      }
      return;
    }
    // Gallery mode: open in Designer Studio
    setRecentlyUsed((prev) => [t._id, ...prev.filter((id) => id !== t._id)].slice(0, 20));
    navigate(`/designer-studio?templateId=${t._id}`);
  };

  const toggleFavorite = (id: string) =>
    setFavorites((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleDuplicate = async (t: TemplateRecord) => {
    setDuplicatingTemplateId(t._id);
    try {
      const copy = await createTemplate({
        productId: t.productId ?? "",
        templateName: `${t.templateName} (Copy)`,
        preview_image: resolveTemplatePreview(t),
        category: (t.category as any) || "Other",
        designData: t.designData ?? {},
        isGlobal: t.isGlobal ?? false,
        isPublic: t.isGlobal ?? false,
      });
      setTemplates((prev) => [copy, ...prev]);
      toast.success(`"${copy.templateName}" created.`);
    } catch (err) {
      toast.error((err as Error).message || "Failed to duplicate template.");
    } finally {
      setDuplicatingTemplateId(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const { deleteTemplate } = await import("../../lib/templateApi");
      await deleteTemplate(deleteTarget._id);
      setTemplates((prev) => prev.filter((t) => t._id !== deleteTarget._id));
      setFavorites((prev) => prev.filter((id) => id !== deleteTarget._id));
      setRecentlyUsed((prev) => prev.filter((id) => id !== deleteTarget._id));
      toast.success(`"${deleteTarget.templateName}" deleted.`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error((err as Error).message || "Failed to delete template.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClearFilters = () => {
    setQuery(""); setSelectedCategories(["all"]); setSelectedSizes(["all"]);
    setOrientation("all"); setDropdownSize("all"); setDropdownCategory("all");
    setDropdownOrientation("all"); setCurrentPage(1);
  };

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: "all",         label: "All Templates", icon: <span className="text-base leading-none">⊞</span> },
    { id: "recommended", label: "Recommended",   icon: <Heart className="h-4 w-4" /> },
    { id: "recent",      label: "Recently Used", icon: <Clock className="h-4 w-4" /> },
    { id: "favorites",   label: "Favorites",     icon: <Star  className="h-4 w-4" /> },
  ];

  // Pagination page list
  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | "…")[] = [1];
    if (currentPage > 3)        pages.push("…");
    const lo = Math.max(2, currentPage - 1);
    const hi = Math.min(totalPages - 1, currentPage + 1);
    for (let p = lo; p <= hi; p++) pages.push(p);
    if (currentPage < totalPages - 2) pages.push("…");
    pages.push(totalPages);
    return pages;
  }, [currentPage, totalPages]);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <DeleteConfirmModal
          template={deleteTarget}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          isDeleting={isDeleting}
        />
      )}

      {/* ── Header ── */}
      <div className="flex items-start justify-between border-b bg-white px-6 py-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Template Gallery</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Browse public templates, open any design, customize it in Designer Studio, and save as a new template.
          </p>
        </div>
        <button
          onClick={() => navigate(projectId ? `/projects/${projectId}` : "/projects")}
          className="ml-4 flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
        >
          <ChevronLeft className="h-4 w-4" /> Back to Project
        </button>
      </div>

      {/* ── Top filter bar ── */}
      <div className="flex flex-wrap items-center gap-3 border-b bg-white px-6 py-3">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates by name, type, or audience..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-8 text-sm outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Size dropdown */}
        <div className="relative">
          <select
            value={dropdownSize}
            onChange={(e) => setDropdownSize(e.target.value)}
            className="appearance-none rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-7 text-sm text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all cursor-pointer"
          >
            {SIDEBAR_SIZES.map((s) => (
              <option key={s.value} value={s.value}>{s.value === "all" ? "Size" : s.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>

        {/* Category dropdown */}
        <div className="relative">
          <select
            value={dropdownCategory}
            onChange={(e) => setDropdownCategory(e.target.value)}
            className="appearance-none rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-7 text-sm text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all cursor-pointer"
          >
            {SIDEBAR_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.value === "all" ? "Category" : c.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>

        {/* Orientation dropdown */}
        <div className="relative">
          <select
            value={dropdownOrientation}
            onChange={(e) => setDropdownOrientation(e.target.value)}
            className="appearance-none rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-7 text-sm text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all cursor-pointer"
          >
            <option value="all">Orientation</option>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>

        <button
          onClick={handleClearFilters}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Clear Filters
        </button>
      </div>

      {/* ── Body (sidebar + content) ── */}
      <div className="flex flex-1 gap-5 px-6 py-5">

        {/* ── LEFT SIDEBAR ── */}
        <aside className="w-56 shrink-0">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Refine Templates</h2>
              <button onClick={handleClearFilters} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </div>

            {/* Category */}
            <div className="mb-5">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Category</span>
                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
              </div>
              <div className="space-y-2">
                {SIDEBAR_CATEGORIES.map((cat) => (
                  <label key={cat.value} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedCategories.includes(cat.value)}
                      onChange={() => setSelectedCategories(toggleCheckbox(cat.value, selectedCategories, SIDEBAR_CATEGORIES.map((c) => c.value)))}
                      className="h-3.5 w-3.5 rounded border-gray-300 accent-blue-600"
                    />
                    <span className="text-xs text-gray-700">{cat.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Size */}
            <div className="mb-5">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Size</span>
                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
              </div>
              <div className="space-y-2">
                {SIDEBAR_SIZES.map((sz) => (
                  <label key={sz.value} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedSizes.includes(sz.value)}
                      onChange={() => setSelectedSizes(toggleCheckbox(sz.value, selectedSizes, SIDEBAR_SIZES.map((s) => s.value)))}
                      className="h-3.5 w-3.5 rounded border-gray-300 accent-blue-600"
                    />
                    <span className="text-xs text-gray-700">{sz.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Orientation */}
            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Orientation</span>
                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
              </div>
              <div className="space-y-2">
                {(["all", "portrait", "landscape"] as OrientationType[]).map((opt) => (
                  <label key={opt} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="sidebar-orientation"
                      value={opt}
                      checked={orientation === opt}
                      onChange={() => setOrientation(opt)}
                      className="h-3.5 w-3.5 border-gray-300 accent-blue-600"
                    />
                    <span className="text-xs capitalize text-gray-700">
                      {opt === "all" ? "All" : opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* ── RIGHT CONTENT ── */}
        <div className="min-w-0 flex-1 flex flex-col gap-5">

          {/* Tabs + sort */}
          <div className="flex items-end border-b border-gray-200">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all",
                  activeTab === tab.id
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300",
                )}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
            <div className="ml-auto mb-1 flex items-center gap-2">
              <span className="text-xs text-gray-500">Sort by</span>
              <select className="rounded-lg border border-gray-200 bg-white py-1.5 px-2.5 text-xs text-gray-700 outline-none focus:border-blue-400">
                <option>Newest First</option>
                <option>Oldest First</option>
                <option>A–Z</option>
              </select>
              {/* Grid view */}
              <button className="rounded-lg border border-blue-100 bg-blue-50 p-1.5 text-blue-600">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
                  <rect x="1" y="1" width="6" height="6" rx="1"/>
                  <rect x="9" y="1" width="6" height="6" rx="1"/>
                  <rect x="1" y="9" width="6" height="6" rx="1"/>
                  <rect x="9" y="9" width="6" height="6" rx="1"/>
                </svg>
              </button>
              {/* List view */}
              <button className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 hover:bg-gray-50">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 16 16">
                  <line x1="2" y1="4"  x2="14" y2="4"/>
                  <line x1="2" y1="8"  x2="14" y2="8"/>
                  <line x1="2" y1="12" x2="14" y2="12"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span>{error}</span>
              <button
                onClick={() => { lastFetchTimeRef.current = 0; fetchTemplates(); }}
                className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Recommended row (All tab only) */}
          {activeTab === "all" && recommended.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                  <span>✨</span> Recommended for you
                </h2>
                <button className="text-xs font-medium text-blue-600 hover:underline">View all</button>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {recommended.map((t) => (
                  <div key={t._id} className="w-52 shrink-0">
                    <TemplateCard
                      template={t}
                      onUse={handleUseTemplate}
                      onPreview={setPreviewTemplate}
                      isFavorite={favorites.includes(t._id)}
                      onToggleFavorite={toggleFavorite}
                      projectId={projectId}
                      isAttaching={attachingTemplateId === t._id}
                      onDuplicate={handleDuplicate}
                      onDelete={setDeleteTarget}
                      isDuplicating={duplicatingTemplateId === t._id}
                    />
                  </div>
                ))}
                <button className="flex shrink-0 items-center self-center rounded-full border border-gray-200 bg-white p-2 shadow-sm hover:shadow-md transition-all">
                  <ChevronRight className="h-4 w-4 text-gray-600" />
                </button>
              </div>
            </section>
          )}

          {/* All Templates grid */}
          <section className="flex flex-col gap-4">
            {!loading && (
              <h2 className="text-base font-semibold text-gray-900">
                {activeTab === "all" ? "All Templates" : tabs.find((t) => t.id === activeTab)?.label}
                {" "}
                <span className="font-normal text-gray-500">({tabFiltered.length})</span>
              </h2>
            )}

            {loading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : pagedTemplates.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-20 text-center">
                <ImageOff className="mb-3 h-12 w-12 text-gray-300" />
                <p className="text-base font-medium text-gray-500">No templates available</p>
                <p className="mt-1 text-sm text-gray-400">Try adjusting your filters or search query</p>
                <button onClick={handleClearFilters} className="mt-4 text-sm font-medium text-blue-600 hover:underline">
                  Clear all filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {pagedTemplates.map((t) => (
                  <TemplateCard
                    key={t._id}
                    template={t}
                    onUse={handleUseTemplate}
                    onPreview={setPreviewTemplate}
                    isFavorite={favorites.includes(t._id)}
                    onToggleFavorite={toggleFavorite}
                    projectId={projectId}
                    isAttaching={attachingTemplateId === t._id}
                    onDuplicate={handleDuplicate}
                    onDelete={setDeleteTarget}
                    isDuplicating={duplicatingTemplateId === t._id}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-gray-500">
                Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, tabFiltered.length)} of {tabFiltered.length} templates
              </p>
              <div className="flex items-center gap-1">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                  className="rounded-lg border border-gray-200 p-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {pageNumbers.map((p, i) =>
                  p === "…" ? (
                    <span key={`ellipsis-${i}`} className="px-1 text-sm text-gray-400">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p)}
                      className={cn(
                        "h-8 w-8 rounded-lg text-sm font-medium transition-colors",
                        currentPage === p
                          ? "bg-blue-600 text-white"
                          : "border border-gray-200 text-gray-700 hover:bg-gray-50",
                      )}
                    >
                      {p}
                    </button>
                  )
                )}
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="rounded-lg border border-gray-200 p-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Preview modal */}
      {previewTemplate && <PreviewModal template={previewTemplate} onClose={() => setPreviewTemplate(null)} />}
    </div>
  );
}
