import { useParams, Link, useNavigate, useLocation, useSearchParams } from "react-router";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import * as fabric from "fabric";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import {
  ArrowLeft, Plus, Trash2, Edit, Upload, FileText,
  CheckCircle2, Circle, Clock, MoreVertical, Download,
  Package, ListTodo, FolderOpen, Database, Layers, Printer, Pencil, FilePlus, X,
  Filter, MoreHorizontal, UserCircle, FileSpreadsheet, Settings2, Users, GripVertical,
  Crop, Wand2, RotateCcw, ImageIcon, UserPlus, FileDown, Archive, Camera, Loader2,
  QrCode, UserRound, AlertTriangle, Globe, ChevronDown,
} from "lucide-react";
import JSZip from "jszip";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "../components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../components/ui/table";
import {
  loadProjectProducts, addProjectProduct, deleteProjectProduct,
  loadProjectTasks, addProjectTask, updateProjectTask, deleteProjectTask,
  loadProjectFiles, addProjectFile, deleteProjectFile,
  loadProjectTemplates, updateProjectTemplate, deleteProjectTemplate, syncProjectTemplatesFromRemote,
  loadDataFields, saveDataFields, loadDataGroups, addDataGroup, deleteDataGroup, updateDataGroup,
  loadDataRecords, saveDataRecords, deleteDataRecord, updateDataRecord,
  type ProjectProduct, type ProjectTask, type ProjectFile, type ProjectTemplate,
  type DataCategory, type ProjectDataField, type ProjectDataGroup, type ProjectDataRecord,
} from "../../lib/projectStore";
import {
  fetchProjectById as apiFetchProjectById,
  updateProject as apiUpdateProject,
  deleteProject as apiDeleteProject,
  resolveProfileImageUrl,
  uploadImages,
  uploadZipImages,
  fetchProjectRecords,
  saveProjectRecords,
  updateRecordPhoto,
  API_BASE,
} from "../../lib/apiService";
import { DESIGNER_CONTEXT_KEY } from "../../lib/fabricUtils";
import { toast } from "sonner";
import { BulkImportWizard } from "../components/BulkImportWizard";
import { IdCard, IdCardGrid, getTemplateSlugForRender, studentHasPhoto, getTemplateCached, resolveStudentPhotoUrl, resolveTemplateConfig, mapData, getRecordField, type DynamicTextObject } from "../components/preview/TemplateRenderer";
import { createTemplate, deleteTemplate, unlinkTemplateFromProject, mapTemplateRecordToProjectTemplate, migrateProjectTemplatesToDatabase, type TemplateRecord } from "../../lib/templateApi";
import { matchImages, type BulkMatchResult } from "../../lib/imageMatchEngine";
import { subscribeToTemplateUpdates } from "../../lib/realtime";

// ─── Template dialog types ───────────────────────────────────────────────────
type PageFormat = "a4" | "13x19" | "custom";
const PAGE_FORMAT_SIZES: Record<PageFormat, { width: number; height: number }> = {
  a4:    { width: 297, height: 210 },
  "13x19": { width: 330, height: 482 },
  custom:  { width: 210, height: 297 },
};
const TEMPLATE_TYPES: { value: ProjectTemplate["templateType"]; label: string }[] = [
  { value: "id_card",     label: "ID Card" },
  { value: "certificate", label: "Certificate" },
  { value: "poster",      label: "Poster" },
  { value: "custom",      label: "Custom" },
];

type PreviewTemplateOption = ProjectTemplate & { isGlobal?: boolean };

function mapApiTemplateToProjectTemplate(template: TemplateRecord): PreviewTemplateOption {
  const mapped = mapTemplateRecordToProjectTemplate(template);
  return {
    ...mapped,
    isGlobal: template.isGlobal === true,
  };
}
const emptyTemplateForm = {
  templateName: "",
  templateType: "id_card" as ProjectTemplate["templateType"],
  pageFormat: "a4" as PageFormat,
  canvas: { width: 297, height: 210 },
  margin: { top: 1, left: 1, right: 1, bottom: 1 },
  applicableFor: "",
  isPublic: false,
};

const STAGES = [
  "draft", "data-uploaded", "designing", "proof-sent",
  "approved", "printing", "dispatched", "delivered",
];
const STAGE_LABELS: Record<string, string> = {
  "draft": "Draft", "data-uploaded": "Data Uploaded", "designing": "Designing",
  "proof-sent": "Proof Sent", "approved": "Approved", "printing": "Printing",
  "dispatched": "Dispatched", "delivered": "Delivered",
};

const PRODUCT_CATEGORIES = [
  "ID Card", "Lanyard", "Year Book", "Photo Book",
  "Calendar", "Certificate", "Diary", "Album", "Other",
];

const emptyProductForm = { productName: "", spec: "", quantity: "1", unitPrice: "" };
const emptyTaskForm = { title: "", assignee: "", dueDate: "", status: "pending" as ProjectTask["status"] };
const emptyFileForm = { name: "", category: "other" as ProjectFile["category"] };

type PreviewPageSize = "A4" | "A3" | "Letter" | "Legal" | "Custom";

interface PreviewGenerationForm {
  pageSize: PreviewPageSize;
  templateId: string;
  orientation: "portrait" | "landscape";
  templateType: ProjectTemplate["templateType"];
  isSample: "yes" | "no";
  sheetWidthMm: string;
  sheetHeightMm: string;
  pageMarginTopMm: string;
  pageMarginLeftMm: string;
  rowMarginMm: string;
  columnMarginMm: string;
  fileName: string;
}

const PAGE_SIZE_DIMENSIONS: Record<Exclude<PreviewPageSize, "Custom">, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  Letter: { width: 216, height: 279 },
  Legal: { width: 216, height: 356 },
};

const emptyPreviewForm: PreviewGenerationForm = {
  pageSize: "A4",
  templateId: "",
  orientation: "portrait",
  templateType: "id_card",
  isSample: "no",
  sheetWidthMm: "210",
  sheetHeightMm: "297",
  pageMarginTopMm: "8",
  pageMarginLeftMm: "8",
  rowMarginMm: "4",
  columnMarginMm: "4",
  fileName: "preview",
};

const GROUP_FILTER_ALL = "__all__";
const MONGO_ID_REGEX = /^[a-f\d]{24}$/i;
const isMongoId = (value?: string | null) => Boolean(value && MONGO_ID_REGEX.test(value));

const emptyNewGroupFilters = {
  classValue: GROUP_FILTER_ALL,
  gender: GROUP_FILTER_ALL,
  transport: GROUP_FILTER_ALL,
  boarding: GROUP_FILTER_ALL,
  house: GROUP_FILTER_ALL,
};

const GROUP_FILTER_SOURCE_KEYS = {
  classValue: ["Class", "class", "className", "Standard", "standard", "grade", "Grade"],
  gender: ["Gender", "gender", "sex", "Sex"],
  transport: ["Transport", "transport", "transportMode", "transport_mode"],
  boarding: ["Boarding", "boarding", "boardingStatus", "boarding_status", "boarder"],
  house: ["House", "house", "schoolHouse", "school_house"],
} as const;

const DEFAULT_GROUP_FILTER_OPTIONS = {
  classValue: ["Pre-Primary", "1-5", "6-8", "9-12"],
  gender: ["Male", "Female", "Other"],
  transport: ["Bus", "Van", "Self"],
  boarding: ["Day Scholar", "Hosteller"],
  house: ["Red", "Blue", "Green", "Yellow"],
} as const;

interface TemplatePreviewDiagnostics {
  hasValidLayoutJson: boolean;
  elementCount: number;
  hasDesignElements: boolean;
  hasThumbnail: boolean;
  hasRenderablePreview: boolean;
  requiredFieldKeys: string[];
  missingFieldKeys: string[];
  fallbackMessage: string;
}

const FIELD_KEY_ALIASES: Array<[string, string[]]> = [
  ["name", ["name", "studentname", "fullname", "candidate", "username"]],
  ["photo", ["photo", "photourl", "profilepic", "profileimage", "image", "avatar", "picture"]],
  ["class", ["class", "classname", "standard", "grade"]],
  ["gender", ["gender", "sex"]],
  ["house", ["house", "schoolhouse"]],
  ["transport", ["transport", "transportmode"]],
  ["boarding", ["boarding", "boardingstatus", "boarder"]],
];

function normalizeFieldKey(rawKey: string): string {
  return String(rawKey || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toCanonicalFieldKey(rawKey: string): string {
  const normalized = normalizeFieldKey(rawKey);
  if (!normalized) return "";
  for (const [canonical, aliases] of FIELD_KEY_ALIASES) {
    if (aliases.includes(normalized)) {
      return canonical;
    }
  }
  return normalized;
}

function formatFieldLabel(canonicalKey: string): string {
  if (!canonicalKey) return "";
  return canonicalKey.charAt(0).toUpperCase() + canonicalKey.slice(1);
}

// ─── Live Fabric.js canvas preview (fallback when thumbnail absent) ──────────
const MM_TO_PX_PREVIEW = 96 / 25.4;

function TemplatePreviewCanvas({
  canvasJSON,
  canvasConfig,
  maxWidth = 320,
  maxHeight = 320,
}: {
  canvasJSON: string;
  canvasConfig: { width: number; height: number };
  maxWidth?: number;
  maxHeight?: number;
}) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const canvasPxW = Math.round(canvasConfig.width * MM_TO_PX_PREVIEW);
  const canvasPxH = Math.round(canvasConfig.height * MM_TO_PX_PREVIEW);
  const scale = Math.min(maxWidth / canvasPxW, maxHeight / canvasPxH, 1);

  // Stable JSON string ref so the effect deps don't churn on every render
  const canvasJSONRef = useRef(canvasJSON);
  canvasJSONRef.current = canvasJSON;

  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;

    let fc: fabric.Canvas | null = null;
    let cancelled = false;

    let canvasData: object = {};
    try {
      const parsed = JSON.parse(canvasJSONRef.current) as Record<string, unknown>;
      if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
        canvasData = ((parsed.pages[0] as Record<string, unknown>).canvas as object | undefined) ?? {};
      } else if (parsed.canvas && typeof parsed.canvas === "object") {
        canvasData = parsed.canvas as object;
      }
    } catch {
      setHasError(true);
      setIsLoading(false);
      return;
    }

    try {
      fc = new fabric.Canvas(el, {
        width: canvasPxW,
        height: canvasPxH,
        selection: false,
        interactive: false,
        renderOnAddRemove: false,
      });

      fc.loadFromJSON(JSON.stringify(canvasData)).then(() => {
        if (cancelled || !fc) return;
        fc.getObjects().forEach((obj) => {
          obj.set({ selectable: false, evented: false, hasControls: false });
        });
        fc.renderAll();
        setIsLoading(false);
      }).catch(() => {
        if (!cancelled) { setHasError(true); setIsLoading(false); }
      });
    } catch {
      setHasError(true);
      setIsLoading(false);
    }

    return () => {
      cancelled = true;
      try { fc?.dispose(); } catch { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasPxW, canvasPxH]);

  if (hasError) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <Layers className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Preview unavailable</p>
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-center">
      {isLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center z-10 bg-white/60 rounded"
          style={{ width: Math.round(canvasPxW * scale), height: Math.round(canvasPxH * scale) }}
        >
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <div
        className="shadow-md rounded border border-border overflow-hidden bg-white"
        style={{ width: Math.round(canvasPxW * scale), height: Math.round(canvasPxH * scale) }}
      >
        <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: canvasPxW, height: canvasPxH }}>
          <canvas ref={canvasElRef} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function parseTemplateLayoutJSON(template: ProjectTemplate): Record<string, unknown> | null {
  if (!template.canvasJSON) return null;
  try {
    const parsed = JSON.parse(template.canvasJSON) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractTemplateLayoutObjects(layout: Record<string, unknown> | null): Array<Record<string, unknown>> {
  if (!layout) return [];

  const objects: Array<Record<string, unknown>> = [];

  const pushCanvasObjects = (canvas: unknown) => {
    if (!canvas || typeof canvas !== "object") return;
    const canvasObjects = (canvas as { objects?: unknown }).objects;
    if (!Array.isArray(canvasObjects)) return;
    canvasObjects.forEach((obj) => {
      if (obj && typeof obj === "object") {
        objects.push(obj as Record<string, unknown>);
      }
    });
  };

  pushCanvasObjects(layout.canvas);

  const pages = (layout.pages as Array<{ canvas?: unknown }> | undefined) ?? [];
  pages.forEach((page) => pushCanvasObjects(page.canvas));

  return objects;
}

function collectTemplateRequiredFields(
  template: ProjectTemplate,
  layoutObjects: Array<Record<string, unknown>>
): string[] {
  const fields = new Set<string>();

  if (template.templateType === "id_card") {
    fields.add("name");
    fields.add("photo");
  } else if (template.templateType === "certificate") {
    fields.add("name");
  }

  layoutObjects.forEach((obj) => {
    const dynamicFieldCandidates = [
      obj.variableKey,
      obj.__fieldKey,
      obj.fieldKey,
      obj.dataKey,
      obj.photoField,
    ];

    dynamicFieldCandidates.forEach((candidate) => {
      if (typeof candidate !== "string") return;
      const canonical = toCanonicalFieldKey(candidate);
      if (canonical) fields.add(canonical);
    });

    const text = typeof obj.text === "string" ? obj.text : "";
    if (!text) return;
    const placeholderRegex = /\{([^{}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = placeholderRegex.exec(text)) !== null) {
      const canonical = toCanonicalFieldKey(match[1]);
      if (canonical) fields.add(canonical);
    }
  });

  return Array.from(fields);
}

function inspectTemplatePreview(
  template: ProjectTemplate,
  availableFieldKeys: Set<string>
): TemplatePreviewDiagnostics {
  const parsedLayout = parseTemplateLayoutJSON(template);
  const layoutObjects = extractTemplateLayoutObjects(parsedLayout);
  const elementCount = layoutObjects.length;
  const hasValidLayoutJson = Boolean(parsedLayout);
  const hasDesignElements = hasValidLayoutJson && elementCount > 0;
  const hasThumbnail = typeof template.thumbnail === "string" && template.thumbnail.trim().length > 0;
  const requiredFieldKeys = collectTemplateRequiredFields(template, layoutObjects);
  const missingFieldKeys = requiredFieldKeys.filter((fieldKey) => !availableFieldKeys.has(fieldKey));

  return {
    hasValidLayoutJson,
    elementCount,
    hasDesignElements,
    hasThumbnail,
    hasRenderablePreview: hasDesignElements && hasThumbnail,
    requiredFieldKeys,
    missingFieldKeys,
    fallbackMessage: hasDesignElements ? "" : "Click 'Edit' to open Designer Studio and create a design.",
  };
}

const mapApiProjectToUi = (p: any) => {
  const populatedClient = typeof p.clientId === "object" && p.clientId !== null ? p.clientId : null;
  const stage = String(p.stage || p.status || "draft");

  return {
    id: String(p._id || p.id),
    name: String(p.name || "Untitled Project"),
    client: String(p.client || populatedClient?.clientName || "Unknown Client"),
    clientId: String(populatedClient?._id || p.clientId || ""),
    stage,
    priority: (p.priority || "medium") as "urgent" | "high" | "medium" | "low",
    dueDate: String(p.dueDate || ""),
    assignee: String(p.assignee || ""),
    amount: Number(p.amount || 0),
    description: String(p.description || ""),
    workflowType: (p.workflowType || "variable_data") as "variable_data" | "direct_print",
    createdAt: String(p.createdAt || new Date().toISOString()),
  };
};

const getRecordPhoto = (rec: ProjectDataRecord): string => {
  const candidate =
    rec.profilePic
    ?? rec.profilepic
    ?? rec.link
    ?? rec.photoUrl
    ?? rec.photo_url
    ?? rec.imageUrl
    ?? rec.image_url
    ?? rec.photo
    ?? rec.Photo
    ?? rec.image
    ?? rec.Image
    ?? rec.avatar
    ?? rec.Avatar
    ?? rec.picture
    ?? rec.Picture;
  return typeof candidate === "string" ? candidate : "";
};

function isPhotoFieldKey(key: string): boolean {
  const normalized = String(key || "").toLowerCase().replace(/[\s_-]/g, "");
  return [
    "photo",
    "photourl",
    "photopath",
    "image",
    "imageurl",
    "avatar",
    "picture",
    "profileimage",
    "studentphoto",
  ].includes(normalized);
}

function getRecordPhotoUrl(rec: ProjectDataRecord): string {
  const value = getRecordPhoto(rec);
  if (!value) return '';
  const trimmed = value.trim();
  // Only display values that are confirmed uploaded URLs or embedded data.
  // A bare filename like "101_syali.jpg" (from a CSV Photo column) is just
  // matching metadata — it has NOT been uploaded yet and must not be resolved
  // to an upload URL. After a real ZIP/folder upload the backend overwrites
  // this field with the full http:// URL.
  const isConfirmedUrl =
    /^(data:image\/|blob:|https?:\/\/)/i.test(trimmed) ||
    trimmed.startsWith('/uploads/') ||
    trimmed.startsWith('uploads/');
  if (!isConfirmedUrl) return '';
  return resolveProfileImageUrl(trimmed);
}
const DEFAULT_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 36 36'%3E%3Ccircle cx='18' cy='18' r='18' fill='%23e2e8f0'/%3E%3Ccircle cx='18' cy='14' r='6' fill='%2394a3b8'/%3E%3Cellipse cx='18' cy='30' rx='10' ry='7' fill='%2394a3b8'/%3E%3C/svg%3E";
const MM_TO_PX = 96 / 25.4;
const PREVIEW_CARD_WIDTH_PX = 250;
const PREVIEW_CARD_HEIGHT_PX = 350;

/**
 * Returns a copy of records with base64 data URLs removed from the `photo` field.
 * Base64 images can be hundreds of KB each — storing them in MongoDB causes the
 * document to exceed the 16 MB BSON limit and the save fails silently.
 * Only server-relative paths ("/uploads/...") or absolute https:// URLs are kept.
 */
function toDbSafeRecords(records: ProjectDataRecord[]): ProjectDataRecord[] {
  return records.map((r) => {
    const photo = String((r as Record<string, unknown>).photo ?? "");
    if (photo.startsWith("data:")) {
      const { photo: _stripped, ...rest } = r as Record<string, unknown>;
      return rest as ProjectDataRecord;
    }
    return r;
  });
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [version, setVersion] = useState(0);
  const [project, setProject] = useState<ReturnType<typeof mapApiProjectToUi> | null>(null);
  const [projectLoading, setProjectLoading] = useState(true);
  void version;

  // dialogs
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isAddTaskOpen, setIsAddTaskOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);

  // forms
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [productErrors, setProductErrors] = useState<Partial<typeof emptyProductForm>>({});
  const [taskForm, setTaskForm] = useState(emptyTaskForm);
  const [taskErrors, setTaskErrors] = useState<Partial<typeof emptyTaskForm>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const dataInputRef = useRef<HTMLInputElement>(null);
  const addFileDialogInputRef = useRef<HTMLInputElement>(null);

  // Add File dialog state
  const [isAddFileOpen, setIsAddFileOpen] = useState(false);
  const [addFileState, setAddFileState] = useState<{
    file: File | null;
    name: string;
    category: ProjectFile["category"];
  }>({ file: null, name: "", category: "other" });

  // ── Project Data tab state ──
  const dataUploadRef = useRef<HTMLInputElement>(null);
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [dataCategory, setDataCategory] = useState<DataCategory>("student");
  const [dataSubTab, setDataSubTab] = useState<"data" | "groups" | "fields">("data");
  const [dataRecords, setDataRecords] = useState<ProjectDataRecord[]>(() =>
    id ? loadDataRecords(id, "student") : []
  );
  const [dataFields, setDataFields] = useState<ProjectDataField[]>(() =>
    id ? loadDataFields(id, "student") : []
  );
  const [dataGroups, setDataGroups] = useState<ProjectDataGroup[]>(() =>
    id ? loadDataGroups(id, "student") : []
  );
  const [dataFilter, setDataFilter] = useState("");
  const [dataSelectedIds, setDataSelectedIds] = useState<Set<string>>(new Set());
  const [isEditFieldsOpen, setIsEditFieldsOpen] = useState(false);
  const [editFieldsDraft, setEditFieldsDraft] = useState<ProjectDataField[]>([]);
  const [isAddGroupOpen, setIsAddGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupTemplateId, setNewGroupTemplateId] = useState("");
  const [newGroupFilters, setNewGroupFilters] = useState({ ...emptyNewGroupFilters });

  // Reload data records: prefer backend (persistent), fall back to localStorage
  useEffect(() => {
    if (!id) return;
    // Immediately load from localStorage for a fast first render
    const localRecords = loadDataRecords(id, dataCategory);
    setDataRecords(localRecords);
    setDataFields(loadDataFields(id, dataCategory));
    setDataGroups(loadDataGroups(id, dataCategory));
    setDataSelectedIds(new Set());

    // Hydrate from backend — backend is the source of truth for server-hosted images.
    // MERGE strategy: if a DB record has no photo but the local record does (e.g. a
    // base64 fallback from when the upload API was unavailable), keep the local photo
    // so photos are never silently erased by a stale DB document.
    let cancelled = false;
    fetchProjectRecords(id, dataCategory).then((backendRecords) => {
      if (cancelled) return; // component unmounted or deps changed — discard stale result
      if (backendRecords && backendRecords.length > 0) {
        const localById = new Map(localRecords.map((r) => [r.id, r]));
        const merged: ProjectDataRecord[] = backendRecords.map((br) => {
          const brTyped = br as ProjectDataRecord;
          const brPhoto = String((brTyped as Record<string, unknown>).photo ?? "").trim();
          if (!brPhoto) {
            // DB record has no photo — preserve whatever is in localStorage for this record
            const local = localById.get(brTyped.id);
            const localPhoto = String((local as Record<string, unknown> | undefined)?.photo ?? "").trim();
            if (localPhoto) return { ...brTyped, photo: localPhoto };
          }
          return brTyped;
        });
        setDataRecords(merged);
        // Save merged back to localStorage, but strip any base64 photos to
        // prevent QuotaExceededError (282+ records × ~100 KB each = localStorage overflow).
        // Only server-relative /uploads/... paths survive in localStorage.
        saveDataRecords(id, dataCategory, toDbSafeRecords(merged));
      }
    });
    return () => { cancelled = true; };
  }, [id, dataCategory]);

  // ── Data action dialog state ──
  const photoUploadRef = useRef<HTMLInputElement>(null);
  const bulkImageFolderRef = useRef<HTMLInputElement>(null);
  const bulkImageZipRef = useRef<HTMLInputElement>(null);
  const [imageUploadTarget, setImageUploadTarget] = useState("selection");
  const [isBulkImageUploadOpen, setIsBulkImageUploadOpen] = useState(false);

  const [bulkImageProcessing, setBulkImageProcessing] = useState(false);
  const [bulkImageResults, setBulkImageResults] = useState<BulkMatchResult | null>(null);
  const [manualAssign, setManualAssign] = useState<Record<string, string>>({}); // filename → userId override
  const bulkImageDataUrlsRef = useRef<Map<string, string>>(new Map()); // filename → dataUrl
  const bulkImageFilesRef = useRef<Map<string, File>>(new Map()); // filename → File (for server upload)
  // Pre-uploaded server URLs for ZIP upload (files already on server — no re-upload needed)
  const zipServerUrlsRef = useRef<Map<string, string>>(new Map()); // filename → serverUrl
  const [isAddDataOpen, setIsAddDataOpen] = useState(false);
  const [addDataDraft, setAddDataDraft] = useState<Record<string, string>>({});
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [bulkEditField, setBulkEditField] = useState("");
  const [bulkEditValue, setBulkEditValue] = useState("");
  const [aiProcessing, setAiProcessing] = useState<string | null>(null);
  const [isGenerateBarcodeOpen, setIsGenerateBarcodeOpen] = useState(false);
  const [barcodeField, setBarcodeField] = useState("");
  const [isGeneratePreviewOpen, setIsGeneratePreviewOpen] = useState(false);
  const [previewDialogStep, setPreviewDialogStep] = useState<1 | 2>(1);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewProgressText, setPreviewProgressText] = useState("");
  // Used to abort an in-progress generation when the dialog is closed.
  const abortRef = useRef<AbortController | null>(null);
  const [previewForm, setPreviewForm] = useState<PreviewGenerationForm>(emptyPreviewForm);
  const [isDeleteAllOpen, setIsDeleteAllOpen] = useState(false);

  // Template dialog state
  const [isCreateTemplateOpen, setIsCreateTemplateOpen] = useState(false);
  const [isTemplateSaving, setIsTemplateSaving] = useState(false);
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm);
  const [templateErrors, setTemplateErrors] = useState<{ templateName?: string; applicableFor?: string }>({});
  const [previewTemplate, setPreviewTemplate] = useState<ProjectTemplate | null>(null);
  const [brokenTemplatePreviewIds, setBrokenTemplatePreviewIds] = useState<Record<string, true>>({});
  const [activeTab, setActiveTab] = useState(() => searchParams.get("tab") || "details");
  // Pre-populate from localStorage so templates appear instantly after refresh while
  // the DB fetch runs in the background. The fetch will either confirm these (override)
  // or fail gracefully (these remain visible with an error banner).
  const [remoteTemplates, setRemoteTemplates] = useState<PreviewTemplateOption[]>(() => {
    if (!id) return [];
    try {
      return loadProjectTemplates(id)
        .filter((t) => t.projectId === id && (isMongoId(t.id) || isMongoId(t.remoteId)))
        .map((t) => ({ ...t, isGlobal: t.isPublic ?? false }));
    } catch { return []; }
  });
  const [remoteTemplatesLoading, setRemoteTemplatesLoading] = useState(false);
  const [remoteTemplatesError, setRemoteTemplatesError] = useState("");
  const [deleteConfirmTemplate, setDeleteConfirmTemplate] = useState<ProjectTemplate | null>(null);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);
  const templateMigrationRef = useRef(false);
  const realtimeRefreshRef = useRef<number | null>(null);
  // Separate version counter for templates-only re-fetch.
  // Incrementing this triggers a template reload without touching project data.
  const [templateFetchVersion, setTemplateFetchVersion] = useState(0);
  const refetchTemplates = useCallback(() => setTemplateFetchVersion((v) => v + 1), []);

  // Sync activeTab when the URL ?tab= param changes (e.g., after returning from Template Gallery)
  useEffect(() => {
    const tabFromUrl = searchParams.get("tab");
    if (tabFromUrl) setActiveTab(tabFromUrl);
  }, [searchParams]);

  // When returning from Template Gallery after attaching a template, immediately
  // add the new template to remoteTemplates so it appears without waiting for
  // the async Atlas DB re-fetch (which can be slow on Atlas M0).
  useEffect(() => {
    const attached = (location.state as Record<string, unknown> | null)?.justAttachedTemplate;
    if (!attached) return;
    const mapped = mapApiTemplateToProjectTemplate(attached as TemplateRecord);
    setRemoteTemplates((prev) => {
      if (prev.some((t) => t.id === mapped.id)) return prev;
      const next = [...prev, mapped];
      syncProjectTemplatesFromRemote(id ?? '', next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  useEffect(() => {
    templateMigrationRef.current = false;
    // When the project id changes (user navigates to a different project),
    // reset remoteTemplates to the localStorage preload for the new project
    // so we don't flash the previous project's templates while the fetch runs.
    if (!id) {
      setRemoteTemplates([]);
      return;
    }
    try {
      const preload = loadProjectTemplates(id)
        .filter((t) => t.projectId === id && (isMongoId(t.id) || isMongoId(t.remoteId)))
        .map((t) => ({ ...t, isGlobal: t.isPublic ?? false }));
      setRemoteTemplates(preload);
    } catch {
      setRemoteTemplates([]);
    }
  }, [id]);

  const updateTemplateMargin = (key: keyof typeof emptyTemplateForm.margin, val: number) =>
    setTemplateForm((f) => ({ ...f, margin: { ...f.margin, [key]: val } }));
  const updateTemplateCanvas = (key: keyof typeof emptyTemplateForm.canvas, val: number) =>
    setTemplateForm((f) => ({ ...f, canvas: { ...f.canvas, [key]: val } }));

  useEffect(() => {
    let mounted = true;
    if (!id) {
      setProject(null);
      setProjectLoading(false);
      return;
    }

    setProjectLoading(true);
    apiFetchProjectById(id)
      .then((data) => {
        if (!mounted) return;
        setProject(data ? mapApiProjectToUi(data) : null);
        setProjectLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setProject(null);
        setProjectLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [id, version]);

  useEffect(() => {
    let mounted = true;
    if (!id) {
      setRemoteTemplates([]);
      setRemoteTemplatesError("");
      return;
    }

    const controller = new AbortController();
    const timeoutId  = window.setTimeout(() => controller.abort(), 45_000);

    const requestUrl = `${API_BASE}/templates?projectId=${encodeURIComponent(id)}`;
    setRemoteTemplatesLoading(true);
    setRemoteTemplatesError("");

    fetch(requestUrl, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok || json?.success === false) {
          throw new Error(json?.error || "Failed to load templates");
        }
        const items = Array.isArray(json?.data) ? (json.data as TemplateRecord[]) : [];
        return items;
      })
      .then(async (items) => {
        if (!mounted) return;
        const mapped = items.map(mapApiTemplateToProjectTemplate);
        const deduped = Array.from(new Map(mapped.map((t) => [t.id, t])).values());
        setRemoteTemplates(deduped);
        syncProjectTemplatesFromRemote(id, deduped);

        if (!templateMigrationRef.current) {
          const legacy = loadProjectTemplates(id).filter(
            (t) => t.projectId === id && !t.remoteId && !isMongoId(t.id)
          );
          templateMigrationRef.current = true;
          if (legacy.length > 0) {
            try {
              const result = await migrateProjectTemplatesToDatabase(id, legacy);
              result.saved.forEach((saved) => {
                if (saved.sourceId) {
                  updateProjectTemplate(saved.sourceId, { remoteId: saved._id });
                }
              });
              // Re-fetch remote templates after migration to pick up DB ids.
              if (mounted) {
                const refreshResponse = await fetch(requestUrl, { cache: 'no-store' });
                const refreshJson = await refreshResponse.json();
                const refreshItems = Array.isArray(refreshJson?.data)
                  ? (refreshJson.data as TemplateRecord[])
                  : [];
                const refreshMapped = refreshItems.map(mapApiTemplateToProjectTemplate);
                const refreshDeduped = Array.from(new Map(refreshMapped.map((t) => [t.id, t])).values());
                setRemoteTemplates(refreshDeduped);
                syncProjectTemplatesFromRemote(id, refreshDeduped);
              }
            } catch (error) {
              console.warn("[templates] Local migration failed", error);
            }
          }
        }
      })
      .catch((error) => {
        if (!mounted) return;
        const isAbort = error instanceof Error && error.name === 'AbortError';
        console.warn("[preview] Failed to load templates", error);
        // Preserve existing state (from localStorage preload or a previous successful fetch).
        // Never wipe templates because of a transient error — the user's data is still in
        // MongoDB; we just couldn't reach it this time (Atlas M0 cold start, network hiccup).
        setRemoteTemplatesError(
          isAbort
            ? "Templates loading slowly (server waking up). Showing cached data — refresh to retry."
            : (error as Error).message || "Failed to load templates"
        );
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (mounted) setRemoteTemplatesLoading(false);
      });

    return () => {
      mounted = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  // templateFetchVersion increments only when templates need a hard re-fetch
  // (after create/delete/attach/detach). location.key changes when navigating
  // back from Template Gallery to pick up newly attached templates.
  // version is intentionally excluded: project-level refresh must not re-trigger
  // a template fetch (which shows the spinner again unnecessarily).
  }, [id, templateFetchVersion, location.key]);

  // Load data
  const products = id ? loadProjectProducts(id) : [];
  const tasks = id ? loadProjectTasks(id) : [];
  const files = id ? loadProjectFiles(id) : [];
  const templates = id ? loadProjectTemplates(id, project?.clientId ?? "") : [];
  const previewTemplates = useMemo(() => {
    // DB (remoteTemplates) is the single source of truth for live data.
    // localStorage templates serve as:
    //   a) the pre-populated initial state (set at useState init time), and
    //   b) a fallback for unmigrated local-only templates (TMPL-xxx IDs).
    const merged = new Map<string, PreviewTemplateOption>();

    // Step 1: DB templates (or localStorage preload) take unconditional priority.
    remoteTemplates.forEach((t) => merged.set(t.id, t));

    // Step 2: Append local-only templates not yet represented in remoteTemplates.
    // Includes:
    //   - Legacy TMPL-xxx records not yet migrated to DB (!isMongoId(t.id))
    //   - DB-backed templates whose remoteId isn't in the current remoteTemplates set
    //     (e.g., a new template created just before a failed refresh)
    const remoteIds = new Set(remoteTemplates.map((t) => t.id));
    const remoteByRemoteId = new Set(remoteTemplates.map((t) => t.remoteId).filter(Boolean));
    templates.forEach((t) => {
      if (merged.has(t.id)) return; // already in merged (was in remoteTemplates preload)
      const syncedById = remoteIds.has(t.id) || (t.remoteId ? remoteIds.has(t.remoteId) : false);
      const syncedByRemoteId = t.remoteId ? remoteByRemoteId.has(t.remoteId) : false;
      if (!syncedById && !syncedByRemoteId && t.projectId === id) {
        // Include both migrated DB templates (as fallback when DB is unreachable)
        // and unmigrated local-only templates.
        merged.set(t.id, { ...t, isGlobal: t.isPublic ?? false });
      }
    });

    return Array.from(merged.values());
  }, [remoteTemplates, templates, id]);

  const previewTemplateGroups = useMemo(() => {
    // A template belongs to this project if it was created here (projectId === id),
    // even when it is also publicly shared (isGlobal: true).
    const projectTemplates = previewTemplates.filter(
      (template) => !template.isGlobal || template.projectId === id
    );
    const globalTemplates = previewTemplates.filter(
      (template) => template.isGlobal && template.projectId !== id
    );
    return {
      projectTemplates: projectTemplates.sort((a, b) => a.templateName.localeCompare(b.templateName)),
      globalTemplates: globalTemplates.sort((a, b) => a.templateName.localeCompare(b.templateName)),
    };
  }, [previewTemplates]);

  const availableTemplateFieldKeys = useMemo(() => {
    const keys = new Set<string>();

    dataFields.forEach((field) => {
      const fromKey = toCanonicalFieldKey(field.key);
      const fromLabel = toCanonicalFieldKey(field.label);
      if (fromKey) keys.add(fromKey);
      if (fromLabel) keys.add(fromLabel);
    });

    dataRecords.slice(0, 500).forEach((record) => {
      Object.keys(record).forEach((recordKey) => {
        const canonical = toCanonicalFieldKey(recordKey);
        if (canonical) keys.add(canonical);
      });
    });

    return keys;
  }, [dataFields, dataRecords]);

  const templateDiagnosticsMap = useMemo(() => {
    const diagnostics: Record<string, TemplatePreviewDiagnostics> = {};
    // Include both local and remote (DB) templates so the card grid shows correct diagnostics
    previewTemplates.forEach((template) => {
      diagnostics[template.id] = inspectTemplatePreview(template, availableTemplateFieldKeys);
    });
    return diagnostics;
  }, [previewTemplates, availableTemplateFieldKeys]);

  const previewTemplateDiagnosticsMap = useMemo(() => {
    const diagnostics: Record<string, TemplatePreviewDiagnostics> = {};
    previewTemplates.forEach((template) => {
      diagnostics[template.id] = inspectTemplatePreview(template, availableTemplateFieldKeys);
    });
    return diagnostics;
  }, [previewTemplates, availableTemplateFieldKeys]);

  const selectedPreviewTemplateDiagnostics = previewTemplate
    ? previewTemplateDiagnosticsMap[previewTemplate.id]
    : undefined;

  const selectedGenerateTemplate = previewForm.templateId
    ? (previewTemplates.find((template) => template.id === previewForm.templateId) || null)
    : null;
  const selectedGenerateTemplateSlug = selectedGenerateTemplate
    ? getTemplateSlugForRender(selectedGenerateTemplate)
    : "";

  const selectedGenerateTemplateDiagnostics = previewForm.templateId
    ? previewTemplateDiagnosticsMap[previewForm.templateId]
    : undefined;

  const canRenderSelectedTemplateImage = Boolean(
    previewTemplate
    && previewTemplate.thumbnail
    && selectedPreviewTemplateDiagnostics?.hasDesignElements
    && !brokenTemplatePreviewIds[previewTemplate.id]
  );

  const markTemplatePreviewBroken = (templateId: string) => {
    setBrokenTemplatePreviewIds((prev) => {
      if (prev[templateId]) return prev;
      return { ...prev, [templateId]: true };
    });
  };

  useEffect(() => {
    if (!previewForm.templateId) return;

    console.debug("[PreviewUI] selectedTemplate", {
      selectedTemplateId: previewForm.templateId,
      selectedTemplateName: selectedGenerateTemplate?.templateName,
      selectedTemplateSlug: selectedGenerateTemplateSlug,
    });
  }, [previewForm.templateId, selectedGenerateTemplate?.templateName, selectedGenerateTemplateSlug]);

  const refresh = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!id) return;
    const unsubscribe = subscribeToTemplateUpdates(id, () => {
      // SSE event: debounce and re-fetch ONLY templates (not project metadata).
      // Do NOT call refresh() here — that increments version, re-fetches project,
      // and shows the template spinner on every real-time event.
      if (realtimeRefreshRef.current) return;
      realtimeRefreshRef.current = window.setTimeout(() => {
        realtimeRefreshRef.current = null;
        refetchTemplates();
      }, 2_000); // 2 s debounce — avoids spinner on burst saves
    });

    // 30 s polling intentionally removed. It was causing the continuous
    // "Loading templates…" flicker. SSE events handle real-time updates;
    // manual actions call refetchTemplates() directly.

    return () => {
      if (realtimeRefreshRef.current) {
        window.clearTimeout(realtimeRefreshRef.current);
        realtimeRefreshRef.current = null;
      }
      unsubscribe();
    };
  }, [id, refetchTemplates]);

  // ── Template handlers ──
  const validateTemplate = () => {
    const e: { templateName?: string; applicableFor?: string } = {};
    if (!templateForm.templateName.trim()) e.templateName = "Required";
    setTemplateErrors(e);
    return Object.keys(e).length === 0;
  };

  const createBlankTemplateThumbnail = (widthMm: number, heightMm: number) => {
    const pxPerMm = 96 / 25.4;
    const widthPx = Math.max(1, Math.round(widthMm * pxPerMm));
    const heightPx = Math.max(1, Math.round(heightMm * pxPerMm));
    const c = document.createElement("canvas");
    c.width = widthPx;
    c.height = heightPx;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, widthPx - 2, heightPx - 2);
    ctx.fillStyle = "#64748b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fontSize = Math.max(12, Math.floor(Math.min(widthPx, heightPx) * 0.12));
    ctx.font = `600 ${fontSize}px sans-serif`;
    ctx.fillText("No Design", widthPx / 2, heightPx / 2);
    return c.toDataURL("image/png");
  };

  const handleCreateTemplate = async () => {
    if (!validateTemplate() || !id) return;
    const thumb = createBlankTemplateThumbnail(templateForm.canvas.width, templateForm.canvas.height);
    const blankCanvasJSON = JSON.stringify({
      config: {
        templateName: templateForm.templateName,
        templateType: templateForm.templateType,
        canvas: templateForm.canvas,
        margin: templateForm.margin,
      },
      pages: [{ id: "page-1", name: "Page 1", canvas: { objects: [] } }],
      activePageId: "page-1",
      canvas: { objects: [] },
      elementMetadata: [],
    });

    setTemplateForm(emptyTemplateForm);
    setTemplateErrors({});
    setIsCreateTemplateOpen(false);
    setActiveTab("templates");

    setIsTemplateSaving(true);
    try {
      const remoteTemplate = await createTemplate({
        productId: id,
        projectId: id,
        templateName: templateForm.templateName,
        preview_image: thumb,
        category: "Other",
        designData: {
          templateType: templateForm.templateType,
          canvas: templateForm.canvas,
          margin: templateForm.margin,
          applicableFor: templateForm.applicableFor,
          canvasJSON: blankCanvasJSON,
        },
        isGlobal: templateForm.isPublic,
        isPublic: templateForm.isPublic,
      });

      const mapped = mapApiTemplateToProjectTemplate(remoteTemplate);
      setRemoteTemplates((prev) => {
        const next = [...prev.filter((t) => t.id !== mapped.id), mapped];
        syncProjectTemplatesFromRemote(id, next);
        return next;
      });

      // Open the Designer Studio for the newly created template
      const normalizedMargin = {
        top:    Number(templateForm.margin?.top    ?? 0) || 0,
        left:   Number(templateForm.margin?.left   ?? 0) || 0,
        right:  Number(templateForm.margin?.right  ?? 0) || 0,
        bottom: Number(templateForm.margin?.bottom ?? 0) || 0,
      };
      const designerConfig = {
        templateName: mapped.templateName,
        templateType: mapped.templateType,
        canvas: mapped.canvas,
        margin: normalizedMargin,
      };
      localStorage.setItem("vendor_designer_template_config", JSON.stringify(designerConfig));
      localStorage.setItem(DESIGNER_CONTEXT_KEY, JSON.stringify({
        projectId: id,
        templateId: mapped.id,
        projectName: project?.name ?? "",
        templateName: mapped.templateName,
      }));
      navigate(`/designer-studio?templateId=${mapped.id}`);
    } catch (error) {
      console.warn("[templates] Failed to persist project template to MongoDB", error);
      toast.error("Template could not be saved to the server.");
      // Only refresh on failure so the UI reflects the actual DB state.
      // On success the optimistic setRemoteTemplates update is the source of truth
      // until the user returns from Designer Studio (which triggers a fresh fetch via location.key).
      refetchTemplates();
    } finally {
      setIsTemplateSaving(false);
    }
  };

  const resolveRemoteTemplateId = (template: ProjectTemplate) => {
    if (isMongoId(template.remoteId)) return template.remoteId as string;
    if (isMongoId(template.id)) return template.id;
    return "";
  };

  const handleDeleteTemplate = async (template: ProjectTemplate) => {
    if (!id) return;
    const remoteId = resolveRemoteTemplateId(template);
    setIsDeletingTemplate(true);
    try {
      if (remoteId) {
        // Detach from this project only — does NOT delete the template document.
        // The template remains in the Template Gallery if it is globally shared.
        await unlinkTemplateFromProject(remoteId, id);
        setRemoteTemplates((prev) => {
          const next = prev.filter((t) => t.id !== remoteId);
          syncProjectTemplatesFromRemote(id, next);
          return next;
        });
      } else {
        // Local-only template (never synced) — remove from localStorage only.
        deleteProjectTemplate(template.id);
        refetchTemplates();
      }
      toast.success(`"${template.templateName}" removed from project.`);
      setDeleteConfirmTemplate(null);
    } catch (error) {
      console.warn("[templates] Failed to remove template from project", error);
      toast.error("Failed to remove template.");
    } finally {
      setIsDeletingTemplate(false);
    }
  };

  const handleCloneTemplate = async (template: ProjectTemplate) => {
    if (!id) return;
    try {
      const created = await createTemplate({
        productId: id,
        projectId: id,
        templateName: `${template.templateName} (Copy)`,
        preview_image: template.thumbnail || "",
        category: "Other",
        designData: {
          templateType: template.templateType,
          canvas: template.canvas,
          margin: template.margin,
          applicableFor: template.applicableFor,
          canvasJSON: template.canvasJSON,
        },
        isGlobal: false,
        isPublic: false,
      });

      const mapped = mapApiTemplateToProjectTemplate(created);
      setRemoteTemplates((prev) => {
        const next = [...prev.filter((t) => t.id !== mapped.id), mapped];
        syncProjectTemplatesFromRemote(id, next);
        return next;
      });
    } catch (error) {
      console.warn("[templates] Failed to clone template", error);
      toast.error("Failed to create template copy.");
    }
  };

  const productTotal = products.reduce((s, p) => s + p.quantity * p.unitPrice, 0);

  // â”€â”€ Product handlers â”€â”€
  const validateProduct = () => {
    const e: Partial<typeof emptyProductForm> = {};
    if (!productForm.productName.trim()) e.productName = "Required";
    if (!productForm.unitPrice || Number(productForm.unitPrice) <= 0) e.unitPrice = "Enter a valid price";
    if (!productForm.quantity || Number(productForm.quantity) <= 0) e.quantity = "Enter a valid qty";
    setProductErrors(e);
    return Object.keys(e).length === 0;
  };
  const handleAddProduct = () => {
    if (!validateProduct() || !id) return;
    addProjectProduct({
      projectId: id,
      productName: productForm.productName,
      spec: productForm.spec,
      quantity: Number(productForm.quantity),
      unitPrice: Number(productForm.unitPrice),
    });
    setProductForm(emptyProductForm);
    setProductErrors({});
    setIsAddProductOpen(false);
    refresh();
  };

  // â”€â”€ Task handlers â”€â”€
  const validateTask = () => {
    const e: Partial<typeof emptyTaskForm> = {};
    if (!taskForm.title.trim()) e.title = "Required";
    setTaskErrors(e);
    return Object.keys(e).length === 0;
  };
  const handleAddTask = () => {
    if (!validateTask() || !id) return;
    if (editingTask) {
      updateProjectTask(editingTask.id, { ...taskForm });
    } else {
      addProjectTask({ projectId: id, ...taskForm });
    }
    setTaskForm(emptyTaskForm);
    setTaskErrors({});
    setIsAddTaskOpen(false);
    setEditingTask(null);
    refresh();
  };
  const openEditTask = (t: ProjectTask) => {
    setEditingTask(t);
    setTaskForm({ title: t.title, assignee: t.assignee, dueDate: t.dueDate, status: t.status });
    setIsAddTaskOpen(true);
  };
  const toggleTaskStatus = (t: ProjectTask) => {
    const next = t.status === "done" ? "pending" : t.status === "pending" ? "in-progress" : "done";
    updateProjectTask(t.id, { status: next });
    refresh();
  };

  // â”€â”€ File handler â”€â”€
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, category: ProjectFile["category"]) => {
    const flist = e.target.files;
    if (!flist || !id) return;
    Array.from(flist).forEach((f) => {
      addProjectFile({
        projectId: id,
        name: f.name,
        size: `${(f.size / 1024).toFixed(1)} KB`,
        fileType: f.type || "unknown",
        category,
      });
    });
    e.target.value = "";
    refresh();
  };

  const handleAddFileDialogSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setAddFileState({ file: f, name: f.name, category: "other" });
    e.target.value = "";
  };

  const handleAddFileSubmit = () => {
    if (!addFileState.file || !id) return;
    addProjectFile({
      projectId: id,
      name: addFileState.name.trim() || addFileState.file.name,
      size: `${(addFileState.file.size / 1024).toFixed(1)} KB`,
      fileType: addFileState.file.type || "unknown",
      category: addFileState.category,
    });
    setAddFileState({ file: null, name: "", category: "other" });
    setIsAddFileOpen(false);
    refresh();
  };

  // ── Project Data handlers ──
  const switchDataCategory = (cat: DataCategory) => {
    if (!id) return;
    setDataCategory(cat);
    setDataRecords(loadDataRecords(id, cat));
    setDataFields(loadDataFields(id, cat));
    setDataGroups(loadDataGroups(id, cat));
    setDataFilter("");
    setDataSelectedIds(new Set());
  };

  const handleDataUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    const projectId = id; // capture before async
    const category = dataCategory; // capture before async
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) || "";
      // Parse CSV (simple implementation without external lib)
      const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
      if (lines.length < 2) return;
      const parseRow = (line: string): string[] => {
        const result: string[] = [];
        let cur = "";
        let inQuote = false;
        for (const ch of line) {
          if (ch === '"') { inQuote = !inQuote; }
          else if (ch === "," && !inQuote) { result.push(cur.trim()); cur = ""; }
          else { cur += ch; }
        }
        result.push(cur.trim());
        return result;
      };
      const headers = parseRow(lines[0]);
      const newFields: ProjectDataField[] = headers.map((h) => ({ key: h, label: h }));
      const records: ProjectDataRecord[] = lines.slice(1).map((line, i) => {
        const vals = parseRow(line);
        const rec: ProjectDataRecord = {
          id: `REC-${Date.now()}-${i}`,
          projectId,
          category,
        };
        headers.forEach((h, idx) => { rec[h] = vals[idx] ?? ""; });
        return rec;
      });
      saveDataFields(projectId, category, newFields);
      // Strip any lingering photo values from fresh CSV records
      const cleanRecords = records.map((r) => {
        const { photo: _p, Photo: _P, ...rest } = r as Record<string, unknown>;
        void _p; void _P;
        return rest as ProjectDataRecord;
      });
      saveDataRecords(projectId, category, cleanRecords);
      setDataFields(newFields);
      setDataRecords(cleanRecords);

      // Persist to MongoDB so the ZIP-upload endpoint can match against fresh records.
      // This is fire-and-forget from the user's perspective; errors are surfaced as toasts.
      saveProjectRecords(projectId, category, cleanRecords).then((ok) => {
        if (ok) {
          console.log(`[CSV] ${cleanRecords.length} record(s) saved to MongoDB — ready for image mapping`);
          toast.success(`${cleanRecords.length} record(s) imported and synced to server.`);
        } else {
          toast.error('CSV imported locally but failed to sync to server. Image mapping may not work.');
        }
      });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const filteredRecords = dataRecords.filter((r) => {
    if (!dataFilter) return true;
    return Object.values(r).some((v) =>
      String(v).toLowerCase().includes(dataFilter.toLowerCase())
    );
  });

  const groupFilterOptions = useMemo(() => {
    const collectOptions = (candidateKeys: readonly string[], fallback: readonly string[]): string[] => {
      const values = new Set<string>();
      dataRecords.forEach((record) => {
        for (const key of candidateKeys) {
          const value = record[key];
          if (value === undefined || value === null) continue;
          const text = String(value).trim();
          if (!text) continue;
          values.add(text);
          break;
        }
      });

      const sorted = Array.from(values).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      );

      return sorted.length > 0 ? sorted : [...fallback];
    };

    return {
      classValue: collectOptions(GROUP_FILTER_SOURCE_KEYS.classValue, DEFAULT_GROUP_FILTER_OPTIONS.classValue),
      gender: collectOptions(GROUP_FILTER_SOURCE_KEYS.gender, DEFAULT_GROUP_FILTER_OPTIONS.gender),
      transport: collectOptions(GROUP_FILTER_SOURCE_KEYS.transport, DEFAULT_GROUP_FILTER_OPTIONS.transport),
      boarding: collectOptions(GROUP_FILTER_SOURCE_KEYS.boarding, DEFAULT_GROUP_FILTER_OPTIONS.boarding),
      house: collectOptions(GROUP_FILTER_SOURCE_KEYS.house, DEFAULT_GROUP_FILTER_OPTIONS.house),
    };
  }, [dataRecords]);

  const resetAddGroupDialog = () => {
    setNewGroupName("");
    setNewGroupTemplateId("");
    setNewGroupFilters({ ...emptyNewGroupFilters });
  };

  const toggleSelectAll = () => {
    if (dataSelectedIds.size === filteredRecords.length) {
      setDataSelectedIds(new Set());
    } else {
      setDataSelectedIds(new Set(filteredRecords.map((r) => r.id)));
    }
  };

  const deleteSelected = () => {
    if (!id) return;
    dataSelectedIds.forEach((rid) => deleteDataRecord(rid));
    const updated = loadDataRecords(id, dataCategory);
    setDataRecords(updated);
    setDataSelectedIds(new Set());
  };

  const handleSaveFields = () => {
    if (!id) return;
    saveDataFields(id, dataCategory, editFieldsDraft);
    setDataFields(editFieldsDraft);
    setIsEditFieldsOpen(false);
  };

  const handleAddGroup = () => {
    if (!id || !newGroupName.trim()) return;
    const g = addDataGroup({
      projectId: id,
      name: newGroupName.trim(),
      category: dataCategory,
      templateId: newGroupTemplateId || undefined,
      classFilter: newGroupFilters.classValue === GROUP_FILTER_ALL ? undefined : newGroupFilters.classValue,
      genderFilter: newGroupFilters.gender === GROUP_FILTER_ALL ? undefined : newGroupFilters.gender,
      transportFilter: newGroupFilters.transport === GROUP_FILTER_ALL ? undefined : newGroupFilters.transport,
      boardingFilter: newGroupFilters.boarding === GROUP_FILTER_ALL ? undefined : newGroupFilters.boarding,
      houseFilter: newGroupFilters.house === GROUP_FILTER_ALL ? undefined : newGroupFilters.house,
    });
    setDataGroups((prev) => [...prev, g]);
    resetAddGroupDialog();
    setIsAddGroupOpen(false);
  };

  const handleGroupTemplateChange = (groupId: string, templateId: string) => {
    updateDataGroup(groupId, { templateId: templateId || undefined });
    setDataGroups((prev) =>
      prev.map((g) => g.id === groupId ? { ...g, templateId: templateId || undefined } : g)
    );
  };

  // â”€â”€ Stage update â”€â”€

  // Download Excel (CSV)
  const handleDownloadExcel = () => {
    if (!dataFields.length || !filteredRecords.length) return;
    const headers = dataFields.map((f) => f.label);
    const rows = filteredRecords.map((r) => dataFields.map((f) => String(r[f.key] ?? "")));
    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project?.name ?? "data"}_${dataCategory}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download Image Zip
  const handleDownloadImageZip = async () => {
    const records = dataSelectedIds.size > 0
      ? filteredRecords.filter((r) => dataSelectedIds.has(r.id))
      : filteredRecords;
    const withPhotos = records.filter((r) => Boolean(getRecordPhotoUrl(r)));
    if (!withPhotos.length) return;
    const zip = new JSZip();
    const folder = zip.folder("photos")!;
    for (let i = 0; i < withPhotos.length; i += 1) {
      const r = withPhotos[i];
      const src = getRecordPhotoUrl(r);
      if (!src) continue;

      let ext = "jpg";
      let base64 = "";

      if (src.startsWith("data:image/")) {
        const mime = src.slice(5, src.indexOf(";"));
        ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
        base64 = src.split(",")[1] || "";
      } else {
        try {
          const response = await fetch(src);
          if (!response.ok) continue;
          const blob = await response.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Image conversion failed"));
            reader.readAsDataURL(blob);
          });
          const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
          ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
          base64 = dataUrl.split(",")[1] || "";
        } catch {
          continue;
        }
      }

      if (!base64) continue;
      const name = String(r["Name"] ?? r["name"] ?? `record_${i + 1}`).replace(/[^a-z0-9]/gi, "_");
      folder.file(`${name}.${ext}`, base64, { base64: true });
    }
    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project?.name ?? "photos"}_${dataCategory}_images.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Add Data
  const handleOpenAddData = () => {
    const draft: Record<string, string> = {};
    dataFields.forEach((f) => { draft[f.key] = ""; });
    setAddDataDraft(draft);
    setIsAddDataOpen(true);
  };

  const handleCommitAddData = () => {
    if (!id) return;
    const rec: ProjectDataRecord = {
      id: `REC-${Date.now()}`,
      projectId: id,
      category: dataCategory,
      ...addDataDraft,
    };
    const updated = [...dataRecords, rec];
    saveDataRecords(id, dataCategory, updated);
    setDataRecords(updated);
    setAddDataDraft({});
    setIsAddDataOpen(false);
  };

  // Bulk Edit
  const handleCommitBulkEdit = () => {
    if (!id || !bulkEditField) return;
    const targetIds = dataSelectedIds.size > 0
      ? dataSelectedIds
      : new Set(dataRecords.map((r) => r.id));
    const updated = dataRecords.map((r) =>
      targetIds.has(r.id) ? { ...r, [bulkEditField]: bulkEditValue } : r
    );
    saveDataRecords(id, dataCategory, updated);
    setDataRecords(updated);
    setIsBulkEditOpen(false);
    setBulkEditField("");
    setBulkEditValue("");
  };

  // AI Image Auto Crop (canvas center-crop to square)
  const handleAIAutoCrop = async () => {
    const targetIds = dataSelectedIds.size > 0
      ? dataSelectedIds
      : new Set(filteredRecords.map((r) => r.id));
    const toProcess = dataRecords.filter((r) => targetIds.has(r.id) && Boolean(getRecordPhotoUrl(r)));
    if (!toProcess.length) return;
    setAiProcessing("autocrop");
    const doCrop = (dataUrl: string): Promise<string> =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const size = Math.min(img.width, img.height);
          const c = document.createElement("canvas");
          c.width = size; c.height = size;
          c.getContext("2d")!.drawImage(
            img,
            (img.width - size) / 2, (img.height - size) / 2, size, size,
            0, 0, size, size
          );
          resolve(c.toDataURL("image/jpeg", 0.9));
        };
        img.src = dataUrl;
      });
    const updated = [...dataRecords];
    for (const rec of toProcess) {
      const i = updated.findIndex((r) => r.id === rec.id);
      const source = getRecordPhotoUrl(rec);
      if (i >= 0 && source) updated[i] = { ...updated[i], photo: await doCrop(source) };
    }
    if (id) saveDataRecords(id, dataCategory, updated);
    setDataRecords(updated);
    setAiProcessing(null);
  };

  // AI Image Background Remover (canvas corner-color threshold)
  const handleAIBgRemove = async () => {
    const targetIds = dataSelectedIds.size > 0
      ? dataSelectedIds
      : new Set(filteredRecords.map((r) => r.id));
    const toProcess = dataRecords.filter((r) => targetIds.has(r.id) && Boolean(getRecordPhotoUrl(r)));
    if (!toProcess.length) return;
    setAiProcessing("bgremove");
    const doRemoveBg = (dataUrl: string): Promise<string> =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = img.width; c.height = img.height;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, c.width, c.height);
          const px = d.data;
          const [cr, cg, cb] = [px[0], px[1], px[2]];
          const thresh = 40;
          for (let i = 0; i < px.length; i += 4) {
            if (Math.abs(px[i] - cr) + Math.abs(px[i + 1] - cg) + Math.abs(px[i + 2] - cb) < thresh * 3)
              px[i + 3] = 0;
          }
          ctx.putImageData(d, 0, 0);
          resolve(c.toDataURL("image/png"));
        };
        img.src = dataUrl;
      });
    const updated = [...dataRecords];
    for (const rec of toProcess) {
      const i = updated.findIndex((r) => r.id === rec.id);
      const source = getRecordPhotoUrl(rec);
      if (i >= 0 && source) updated[i] = { ...updated[i], photo: await doRemoveBg(source) };
    }
    if (id) saveDataRecords(id, dataCategory, updated);
    setDataRecords(updated);
    setAiProcessing(null);
  };

  // Reset Photo
  const handleResetPhoto = () => {
    if (!id) return;
    const targetIds = dataSelectedIds.size > 0
      ? dataSelectedIds
      : new Set(filteredRecords.map((r) => r.id));
    const updated = dataRecords.map((r) => {
      if (!targetIds.has(r.id)) return r;
      const next = { ...r } as Record<string, unknown>;
      delete next.photo;
      return next as ProjectDataRecord;
    });
    saveDataRecords(id, dataCategory, updated);
    setDataRecords(updated);
  };

  // Image Upload (match by filename, or direct assign when target set)
  // Images are uploaded to the backend so they persist across refreshes.
  const handleImageUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length || !id) return;

    let uploadedUrls: string[];
    try {
      uploadedUrls = await uploadImages(files);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Photo upload failed: ${msg}. Please check your connection and try again.`);
      return;
    }

    const updated = [...dataRecords];
    const tgt = imageUploadTarget;

    if (tgt !== "selection") {
      if (uploadedUrls.length > 0) {
        const i = updated.findIndex((r) => r.id === tgt);
        if (i >= 0) updated[i] = { ...updated[i], photo: uploadedUrls[0] };
      }
    } else {
      const targets = dataSelectedIds.size > 0
        ? filteredRecords.filter((r) => dataSelectedIds.has(r.id))
        : filteredRecords;
      if (targets.length === 1 && uploadedUrls.length === 1) {
        const i = updated.findIndex((r) => r.id === targets[0].id);
        if (i >= 0) updated[i] = { ...updated[i], photo: uploadedUrls[0] };
      } else {
        // Check if any record has an explicit photo-filename column (e.g. "Photo", "Filename")
        // If so, use EXACT filename matching only — no fuzzy/prefix fallback.
        const photoColumnKeys = [
          "Profile Picture", "profile_picture", "ProfilePicture", "profilePicture",
          "Profile Pic", "profile_pic", "ProfilePic",
          "Photo", "photo", "Photo File", "photo_file", "PhotoFile", "photoFile",
          "Filename", "filename", "File Name", "file_name", "FileName",
          "Photo Filename", "photo_filename", "Image", "image", "Image File", "image_file",
        ] as const;
        // Normalise a photo column value the same way as imageMatchEngine:
        // strip \r\n, BOM (\ufeff), non-breaking space (\u00a0), Unicode NFC, lowercase.
        const normalizePhotoKey = (s: string): string => {
          let v = s.trim().replace(/[\r\n\t\u00a0\ufeff]/g, '');
          try { v = v.normalize('NFC'); } catch { /* ignore */ }
          return v.toLowerCase();
        };
        const getPhotoColumnValue = (r: ProjectDataRecord): string => {
          for (const k of photoColumnKeys) {
            const v = (r as Record<string, unknown>)[k];
            if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
          }
          return "";
        };
        const hasPhotoColumn = targets.some((r) => getPhotoColumnValue(r) !== "");

        files.forEach((f, idx) => {
          const photoUrl = uploadedUrls[idx];
          if (!photoUrl) return;
          const filenameLower = f.name.toLowerCase();
          const baseName = f.name.replace(/\.[^.]+$/, "").toLowerCase().trim();
          let match: ProjectDataRecord | undefined;

          if (hasPhotoColumn) {
            // Exact filename match against photo column — both sides normalised
            // (strips invisible chars, BOM, NBSP, lowercases)
            match = targets.find((r) => normalizePhotoKey(getPhotoColumnValue(r)) === normalizePhotoKey(f.name));
          } else {
            match = targets.find((r) => {
              // 1. Match by SchoolCode_AdmissionNumber prefix (e.g. "44837_10_Nitin_.jpg")
              const schoolCode = String(
                r["School Code"] ?? r["schoolCode"] ?? r["school_code"] ?? ""
              ).trim();
              const admNo = String(
                r["Admission Number"] ?? r["admissionNumber"] ?? r["admission_number"] ?? ""
              ).trim();
              if (schoolCode && admNo) {
                const prefix = `${schoolCode}_${admNo}_`.toLowerCase();
                if (baseName.startsWith(prefix)) return true;
              }
              // 2. Match by student name
              const name = String(r["Name"] ?? r["name"] ?? "").toLowerCase().trim();
              if (name === baseName || baseName.startsWith(name) || name.startsWith(baseName)) return true;
              // 3. Match by name tokens appearing in filename segments
              if (name) {
                const segments = baseName.split("_").filter(Boolean);
                const nameTokens = name.split(/\s+/);
                if (nameTokens.every((token) => segments.includes(token))) return true;
              }
              // 4. Match by the record's existing photo field filename
              const existingPhoto = String(getRecordPhoto(r) || "");
              const existingFilename = existingPhoto
                .split("/").pop()!
                .replace(/\.[^.]+$/, "")
                .toLowerCase().trim();
              return existingFilename.length > 0 && (
                existingFilename === baseName ||
                baseName.startsWith(existingFilename) ||
                existingFilename.startsWith(baseName)
              );
            });
          }

          if (match) {
            const i = updated.findIndex((r) => r.id === match!.id);
            if (i >= 0) updated[i] = { ...updated[i], photo: photoUrl };
          }
        });
      }
    }

    saveDataRecords(id, dataCategory, toDbSafeRecords(updated));
    setDataRecords(updated);
    setImageUploadTarget("selection");
    saveProjectRecords(id, dataCategory, toDbSafeRecords(updated)).then((ok) => {
      if (ok) {
        toast.success("Photo saved to server — will persist after refresh.");
      } else {
        toast.error("Photo uploaded but failed to save to server. It may disappear after refresh.");
      }
    });
  };

  // ── Bulk Image Upload (ZIP or folder) ────────────────────────────────────
  const processBulkImageFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name));
    if (!imageFiles.length || !id) return;
    setBulkImageProcessing(true);
    setBulkImageResults(null);
    setManualAssign({});

    // Store File objects keyed by filename for uploading when the user applies
    const fileMap = new Map<string, File>();
    imageFiles.forEach((f) => fileMap.set(f.name, f));
    bulkImageFilesRef.current = fileMap;
    // Ensure ZIP server-URL map is clear (this is a folder upload)
    zipServerUrlsRef.current = new Map();

    // Read all images as data URLs for the preview / matching UI
    const loaded = await Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<{ name: string; dataUrl: string }>((resolve) => {
            const r = new FileReader();
            r.onload = (ev) => resolve({ name: file.name, dataUrl: ev.target!.result as string });
            r.readAsDataURL(file);
          })
      )
    );

    // Store dataUrls for UI preview
    const urlMap = new Map<string, string>();
    loaded.forEach(({ name, dataUrl }) => urlMap.set(name, dataUrl));
    bulkImageDataUrlsRef.current = urlMap;

    const results = matchImages(loaded, dataRecords as Record<string, unknown>[]);
    setBulkImageResults(results);
    setBulkImageProcessing(false);
  };

  const handleBulkImageFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await processBulkImageFiles(files);
  };

  const handleBulkImageZipChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const zipFile = e.target.files?.[0];
    e.target.value = "";
    if (!zipFile || !id) return;

    setBulkImageProcessing(true);
    setBulkImageResults(null);
    setManualAssign({});
    // Clear all stale refs from previous sessions
    bulkImageFilesRef.current    = new Map();
    bulkImageDataUrlsRef.current = new Map();
    zipServerUrlsRef.current     = new Map();

    try {
      // ── Step 1: Send ZIP to backend for extraction + upload only ──────────
      // The backend extracts images and uploads each to the server, then
      // returns [{filename, url}]. NO matching is done on the backend.
      const result = await uploadZipImages(zipFile);

      if (result.errors.length > 0) {
        console.error("[zip-upload] upload errors:", result.errors);
        toast.error(`${result.errors.length} file(s) failed to upload. Check console for details.`);
      }

      if (!result.files.length) {
        toast.error("No images were extracted from the ZIP.");
        return;
      }

      // ── Step 2: Store server URLs for use in Apply (no re-upload needed) ──
      const serverUrlMap = new Map<string, string>();
      result.files.forEach(({ filename, url }) => serverUrlMap.set(filename, url));
      zipServerUrlsRef.current = serverUrlMap;
      // Also populate dataUrlsRef with server URLs so preview images work
      bulkImageDataUrlsRef.current = new Map(serverUrlMap);

      // ── Step 3: Run the SAME matchImages() engine as folder upload ─────────
      // Build ImageFile objects: use the server URL as the dataUrl so thumbnails
      // can still render in the review panel via <img src="…">.
      const imageFiles = result.files.map(({ filename, url }) => ({
        name:    filename,
        dataUrl: url,
      }));

      const matchResult = matchImages(imageFiles, dataRecords as Record<string, unknown>[]);
      setBulkImageResults(matchResult);

      // ── Step 4: Report summary toasts ─────────────────────────────────────
      const matchedCount   = matchResult.matched.length;
      const unmatchedCount = matchResult.unmatched.length;

      if (matchedCount > 0) {
        toast.success(
          `${matchedCount} photo(s) matched. Click "Apply" to save them.`
        );
      }
      if (unmatchedCount > 0) {
        toast.error(
          `${unmatchedCount} image(s) had no matching student. ` +
          `Check that the "Profile Picture" column in your CSV matches the ZIP filenames exactly.`
        );
      }

      // Keep dialog open so the user can review results and click Apply.
      setBulkImageProcessing(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`ZIP upload failed: ${msg}. Check your connection and try again.`);
      setBulkImageProcessing(false);
      setIsBulkImageUploadOpen(false);
    }
  };

  const handleApplyBulkImages = async () => {
    if (!id || !bulkImageResults) return;

    setBulkImageProcessing(true);

    // ── Determine server URLs ──────────────────────────────────────────────
    // ZIP upload: files already on server → use zipServerUrlsRef (no re-upload)
    // Folder upload: files are local File objects → upload them now
    const isZipMode = zipServerUrlsRef.current.size > 0;
    const serverUrlByFilename = new Map<string, string>();

    if (isZipMode) {
      // Copy pre-uploaded ZIP server URLs
      zipServerUrlsRef.current.forEach((url, filename) => {
        serverUrlByFilename.set(filename, url);
      });
    } else {
      // Folder upload: collect File objects and upload in chunks of 50
      const fileMap = bulkImageFilesRef.current;
      const filesToUpload: { filename: string; file: File }[] = [];
      const collect = (filename: string) => {
        const file = fileMap.get(filename);
        if (file) filesToUpload.push({ filename, file });
      };
      bulkImageResults.matched.forEach(({ filename }) => collect(filename));
      bulkImageResults.unmatched.forEach(({ filename }) => {
        if (manualAssign[filename]) collect(filename);
      });

      if (filesToUpload.length > 0) {
        const CHUNK = 50;
        try {
          for (let i = 0; i < filesToUpload.length; i += CHUNK) {
            const slice = filesToUpload.slice(i, i + CHUNK);
            const urls = await uploadImages(slice.map((x) => x.file));
            slice.forEach(({ filename }, idx) => {
              if (urls[idx]) serverUrlByFilename.set(filename, urls[idx]);
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toast.error(`Photo upload failed: ${msg}. Please check your connection and try again.`);
          setBulkImageProcessing(false);
          setIsBulkImageUploadOpen(false);
          setBulkImageResults(null);
          setManualAssign({});
          bulkImageDataUrlsRef.current = new Map();
          bulkImageFilesRef.current    = new Map();
          zipServerUrlsRef.current     = new Map();
          return;
        }
      }
    }

    const updated = [...dataRecords];

    // Apply auto-matched images — only use server-hosted URLs (never base64)
    bulkImageResults.matched.forEach(({ userId, filename }) => {
      const targetId = manualAssign[filename] ?? userId;
      const photoUrl = serverUrlByFilename.get(filename);
      if (!photoUrl) return;
      const i = updated.findIndex((r) => r.id === targetId);
      if (i >= 0) updated[i] = { ...updated[i], photo: photoUrl };
    });

    // Apply manually reassigned unmatched images — only use server-hosted URLs
    bulkImageResults.unmatched.forEach(({ filename }) => {
      const targetId = manualAssign[filename];
      if (!targetId) return;
      const photoUrl = serverUrlByFilename.get(filename);
      if (!photoUrl) return;
      const i = updated.findIndex((r) => r.id === targetId);
      if (i >= 0) updated[i] = { ...updated[i], photo: photoUrl };
    });

    saveDataRecords(id, dataCategory, toDbSafeRecords(updated));
    setDataRecords(updated);
    setBulkImageProcessing(false);
    setIsBulkImageUploadOpen(false);
    setBulkImageResults(null);
    setManualAssign({});
    bulkImageDataUrlsRef.current = new Map();
    bulkImageFilesRef.current    = new Map();
    zipServerUrlsRef.current     = new Map();
    // Count records that now have a server-hosted photo (any URL that isn't base64)
    const savedCount = updated.filter((r) => {
      const p = String((r as Record<string, unknown>).photo ?? "");
      return p.length > 0 && !p.startsWith("data:");
    }).length;
    saveProjectRecords(id, dataCategory, toDbSafeRecords(updated)).then((ok) => {
      if (ok) {
        toast.success(`${savedCount} photo(s) saved to server — will persist after refresh.`);
      } else {
        toast.error("Photos uploaded but failed to save to server. They may disappear after refresh.");
      }
    });
  };

  // ── Generate Bar Code (draws Code128-style bars onto a canvas per record) ──
  const handleGenerateBarcodes = () => {
    if (!id || !barcodeField) return;
    const targets = dataSelectedIds.size > 0
      ? dataRecords.filter((r) => dataSelectedIds.has(r.id))
      : dataRecords;
    const updated = [...dataRecords];
    targets.forEach((rec) => {
      const val = String(rec[barcodeField] ?? rec.id);
      const c = document.createElement("canvas");
      c.width = 200; c.height = 60;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 200, 60);
      ctx.fillStyle = "#000";
      // Simple visual barcode: alternate bar widths based on char codes
      let x = 4;
      const chars = val.split("");
      const slotW = Math.floor(192 / Math.max(chars.length * 3, 1));
      chars.forEach((ch) => {
        const code = ch.charCodeAt(0);
        [1, 0, 1].forEach((on, idx) => {
          const w = slotW * (on ? ((code >> idx) & 1 ? 2 : 1) : 1);
          if (on) ctx.fillRect(x, 4, w, 44);
          x += w + 1;
        });
      });
      // Label
      ctx.font = "9px monospace";
      ctx.fillText(val.slice(0, 28), 4, 58);
      const dataUrl = c.toDataURL("image/png");
      const i = updated.findIndex((r) => r.id === rec.id);
      if (i >= 0) updated[i] = { ...updated[i], barcode: dataUrl };
    });
    saveDataRecords(id, dataCategory, updated);
    setDataRecords(updated);
    setIsGenerateBarcodeOpen(false);
    setBarcodeField("");
  };

  const selectedRecords = dataRecords.filter((record) => dataSelectedIds.has(record.id));

  const printLayout = useMemo(() => {
    const sheetWidthMm = Number(previewForm.sheetWidthMm);
    const sheetHeightMm = Number(previewForm.sheetHeightMm);
    const pageMarginTopMm = Number(previewForm.pageMarginTopMm);
    const pageMarginLeftMm = Number(previewForm.pageMarginLeftMm);
    const rowMarginMm = Number(previewForm.rowMarginMm || "0");
    const columnMarginMm = Number(previewForm.columnMarginMm || "0");

    const sheetWidthPx = Math.max(1, Math.round(Math.max(sheetWidthMm, 1) * MM_TO_PX));
    const sheetHeightPx = Math.max(1, Math.round(Math.max(sheetHeightMm, 1) * MM_TO_PX));
    const marginTopPx = Math.max(0, Math.round(Math.max(pageMarginTopMm, 0) * MM_TO_PX));
    const marginLeftPx = Math.max(0, Math.round(Math.max(pageMarginLeftMm, 0) * MM_TO_PX));
    const rowGapPx = Math.max(0, Math.round(Math.max(rowMarginMm, 0) * MM_TO_PX));
    const columnGapPx = Math.max(0, Math.round(Math.max(columnMarginMm, 0) * MM_TO_PX));

    const usableWidth = Math.max(1, sheetWidthPx - marginLeftPx * 2);
    const usableHeight = Math.max(1, sheetHeightPx - marginTopPx * 2);
    const columns = Math.max(1, Math.floor((usableWidth + columnGapPx) / (PREVIEW_CARD_WIDTH_PX + columnGapPx)));
    const rows = Math.max(1, Math.floor((usableHeight + rowGapPx) / (PREVIEW_CARD_HEIGHT_PX + rowGapPx)));
    const cardsPerPage = Math.max(1, columns * rows);

    return {
      sheetWidthPx,
      sheetHeightPx,
      marginTopPx,
      marginLeftPx,
      rowGapPx,
      columnGapPx,
      columns,
      rows,
      cardsPerPage,
      sheetWidthMm,
      sheetHeightMm,
    };
  }, [
    previewForm.sheetWidthMm,
    previewForm.sheetHeightMm,
    previewForm.pageMarginTopMm,
    previewForm.pageMarginLeftMm,
    previewForm.rowMarginMm,
    previewForm.columnMarginMm,
  ]);

  const previewPrintPages = useMemo(() => {
    if (!selectedRecords.length) return [] as ProjectDataRecord[][];
    const pages: ProjectDataRecord[][] = [];
    for (let i = 0; i < selectedRecords.length; i += printLayout.cardsPerPage) {
      pages.push(selectedRecords.slice(i, i + printLayout.cardsPerPage));
    }
    return pages;
  }, [selectedRecords, printLayout.cardsPerPage]);

  // Count students without a real photo to show a warning in the dialog.
  const missingPhotosCount = useMemo(
    () => selectedRecords.filter((r) => !studentHasPhoto(r)).length,
    [selectedRecords]
  );

  const handleOpenGeneratePreview = () => {
    const templateFromGroup = dataGroups
      .find((group) => selectedRecords.some((record) => record.groupId === group.id) && Boolean(group.templateId))
      ?.templateId;
    // Prefer own (non-global) templates as default selection
    const defaultTemplate = previewTemplates.find((template) => template.id === templateFromGroup)
      || previewTemplates.find((t) => !t.isGlobal)
      || previewTemplates[0]
      || null;

    setPreviewForm((prev) => ({
      ...prev,
      pageSize: "A4",
      templateId: defaultTemplate?.id || "",
      templateType: defaultTemplate?.templateType || prev.templateType,
      orientation: defaultTemplate?.canvas?.width && defaultTemplate?.canvas?.height
        ? (defaultTemplate.canvas.width > defaultTemplate.canvas.height ? "landscape" : "portrait")
        : prev.orientation,
      sheetWidthMm: String(PAGE_SIZE_DIMENSIONS.A4.width),
      sheetHeightMm: String(PAGE_SIZE_DIMENSIONS.A4.height),
      fileName: `${project?.name || "project"}_${dataCategory}_preview`,
    }));
    setPreviewDialogStep(1);
    setPreviewError("");
    setPreviewProgressText("");
    setIsGeneratePreviewOpen(true);
  };

  const handleGeneratePreviewPdf = async () => {
    if (!id) return;

    const selectedTemplate = previewTemplates.find((t) => t.id === previewForm.templateId);
    const sheetWidthMm = printLayout.sheetWidthMm;
    const sheetHeightMm = printLayout.sheetHeightMm;
    const pageMarginTopMm = Number(previewForm.pageMarginTopMm);
    const pageMarginLeftMm = Number(previewForm.pageMarginLeftMm);
    const rowMarginMm = Number(previewForm.rowMarginMm || "0");
    const columnMarginMm = Number(previewForm.columnMarginMm || "0");

    if (!selectedRecords.length) { setPreviewError("Please select at least one record."); return; }
    if (!previewForm.templateId || !selectedTemplate) { setPreviewError("Please select a template."); return; }
    if (!previewForm.fileName.trim()) { setPreviewError("File name is required."); return; }
    if (!Number.isFinite(sheetWidthMm) || sheetWidthMm <= 0 || !Number.isFinite(sheetHeightMm) || sheetHeightMm <= 0) {
      setPreviewError("Sheet size must be valid positive values."); return;
    }
    if (pageMarginTopMm < 0 || pageMarginLeftMm < 0 || rowMarginMm < 0 || columnMarginMm < 0) {
      setPreviewError("Margins cannot be negative."); return;
    }

    setPreviewError("");
    setIsGeneratingPreview(true);
    setPreviewProgressText("Preparing template…");

    try {
      const cardWidthMm = selectedTemplate.canvas?.width || 54;
      const cardHeightMm = selectedTemplate.canvas?.height || 86;
      const cardWidthPx = Math.max(1, Math.round(cardWidthMm * MM_TO_PX));
      const cardHeightPx = Math.max(1, Math.round(cardHeightMm * MM_TO_PX));

      // ── Extract the first-page canvas object from the template JSON ───────
      // Supported formats: { canvas: {...} }, { pages: [{canvas:{...}}] }, or
      // the canvas object itself ({ objects: [...], ... }).
      let canvasData: object | null = null;
      if (selectedTemplate.canvasJSON) {
        try {
          const parsed = JSON.parse(selectedTemplate.canvasJSON) as Record<string, unknown>;
          if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
            canvasData = ((parsed.pages[0] as { canvas?: object }).canvas) ?? null;
          } else if (parsed.canvas && typeof parsed.canvas === "object") {
            canvasData = parsed.canvas as object;
          } else if (Array.isArray((parsed as { objects?: unknown }).objects)) {
            canvasData = parsed as object;
          }
        } catch {
          /* ignore JSON errors — fall back to thumbnail below */
        }
      }

      const baseJsonStr = canvasData ? JSON.stringify(canvasData) : null;
      const hasThumbnail = typeof selectedTemplate.thumbnail === "string" && selectedTemplate.thumbnail.trim().length > 0;

      if (!baseJsonStr && !hasThumbnail) {
        throw new Error("Template has no design. Open it in the Designer and save first.");
      }

      // ── Layout calculation ────────────────────────────────────────────────
      const usableWidthMm  = sheetWidthMm  - pageMarginLeftMm * 2;
      const usableHeightMm = sheetHeightMm - pageMarginTopMm  * 2;
      const columns     = Math.max(1, Math.floor((usableWidthMm  + columnMarginMm) / (cardWidthMm  + columnMarginMm)));
      const rows        = Math.max(1, Math.floor((usableHeightMm + rowMarginMm)    / (cardHeightMm + rowMarginMm)));
      const cardsPerPage = columns * rows;

      const orientation = sheetWidthMm > sheetHeightMm ? "landscape" : "portrait";
      const doc = new jsPDF({ orientation, unit: "mm", format: [sheetWidthMm, sheetHeightMm], compress: true });

      // ── Render each record ────────────────────────────────────────────────
      for (let i = 0; i < selectedRecords.length; i += 1) {
        const record = selectedRecords[i];
        const cardIndexOnPage = i % cardsPerPage;
        const pageNum = Math.floor(i / cardsPerPage);

        if (cardIndexOnPage === 0 && pageNum > 0) {
          doc.addPage([sheetWidthMm, sheetHeightMm], orientation);
        }

        setPreviewProgressText(`Rendering card ${i + 1} of ${selectedRecords.length}…`);

        const col  = cardIndexOnPage % columns;
        const row  = Math.floor(cardIndexOnPage / columns);
        const xMm  = pageMarginLeftMm + col * (cardWidthMm  + columnMarginMm);
        const yMm  = pageMarginTopMm  + row * (cardHeightMm + rowMarginMm);

        let pngDataUri: string | null = null;

        // ── Path A: Render via Fabric.js with {{VARIABLE}} substitution ──
        if (baseJsonStr) {
          try {
            // Substitute all {{KEY}} placeholders with values from the record.
            // JSON.stringify(val).slice(1,-1) gives a properly JSON-escaped string
            // so special characters like `"` or `\n` don't corrupt the JSON.
            const substituted = baseJsonStr.replace(/\{\{([^}]+)\}\}/g, (_, rawKey: string) => {
              const val = mapData(`{{${rawKey}}}`, record);
              return JSON.stringify(val).slice(1, -1);
            });

            const canvasEl = document.createElement("canvas");
            const fc = new fabric.StaticCanvas(canvasEl, {
              width: cardWidthPx,
              height: cardHeightPx,
              renderOnAddRemove: false,
              enableRetinaScaling: false,
            } as ConstructorParameters<typeof fabric.StaticCanvas>[1]);
            try {
              await fc.loadFromJSON(substituted);
              fc.renderAll();
              pngDataUri = fc.toDataURL({ format: "png", multiplier: 2 } as Parameters<typeof fc.toDataURL>[0]);
            } finally {
              fc.dispose();
            }
          } catch (fabricErr) {
            console.warn("[PDF] Fabric render failed for card", i + 1, fabricErr);
            pngDataUri = null; // fall through to thumbnail
          }
        }

        // ── Path B: Thumbnail fallback ────────────────────────────────────
        if (!pngDataUri && hasThumbnail) {
          pngDataUri = selectedTemplate.thumbnail!;
        }

        if (pngDataUri) {
          doc.addImage(pngDataUri, "PNG", xMm, yMm, cardWidthMm, cardHeightMm);
        }
      }

      setPreviewProgressText("Saving PDF…");
      doc.save(`${previewForm.fileName.trim()}.pdf`);
      setIsGeneratePreviewOpen(false);
    } catch (error) {
      setPreviewError((error as Error).message || "Failed to generate preview PDF.");
    } finally {
      setIsGeneratingPreview(false);
      setPreviewProgressText("");
    }
  };

  // ── Delete All student/staff Data ──
  const handleDeleteAllData = () => {
    if (!id) return;
    saveDataRecords(id, dataCategory, []);
    saveDataFields(id, dataCategory, []);
    setDataRecords([]);
    setDataFields([]);
    setDataSelectedIds(new Set());
    setIsDeleteAllOpen(false);
  };

  const handleStageChange = async (stage: string) => {
    if (!id) return;
    const updated = await apiUpdateProject(id, { stage });
    if (updated) {
      refresh();
    }
  };

  // â”€â”€ Stage change direct edit â”€â”€
  const updateProjectField = async (field: string, value: string) => {
    if (!id) return;
    const updated = await apiUpdateProject(id, { [field]: value });
    if (updated) {
      refresh();
    }
  };

  if (projectLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <p className="text-muted-foreground text-lg">Loading project...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <p className="text-muted-foreground text-lg">Project not found.</p>
        <Link to="/projects">
          <Button variant="outline">Back to Projects</Button>
        </Link>
      </div>
    );
  }

  const stageIndex = STAGES.indexOf(project.stage);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/projects">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-semibold">{project.name}</h1>
            <Badge variant="secondary">{STAGE_LABELS[project.stage] ?? project.stage}</Badge>
            <Badge variant="outline">{project.priority.charAt(0).toUpperCase() + project.priority.slice(1)}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Client: <span className="font-medium text-foreground">{project.client}</span>
            &nbsp;Â·&nbsp;{project.id}
            &nbsp;Â·&nbsp;Created {project.createdAt}
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={project.stage} onValueChange={handleStageChange}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => (
                <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon"><MoreVertical className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/clients/${project.clientId}`}>View Client</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => {
                if (!id) return;
                apiDeleteProject(id).then((ok) => {
                  if (ok) {
                    navigate("/projects");
                  }
                });
              }}>
                Delete Project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Client</p>
            <p className="font-semibold mt-1 truncate">{project.client}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Due Date</p>
            <p className="font-semibold mt-1">{project.dueDate || "—"}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Project Amount</p>
            <p className="font-semibold mt-1">₹{project.amount.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Products Total</p>
            <p className="font-semibold mt-1">₹{productTotal.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Stage Progress Bar */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-1 overflow-x-auto">
            {STAGES.map((s, i) => (
              <div key={s} className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => handleStageChange(s)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    i < stageIndex
                      ? "bg-success/20 text-success"
                      : i === stageIndex
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {i < stageIndex ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <Circle className="h-3 w-3" />
                  )}
                  {STAGE_LABELS[s]}
                </button>
                {i < STAGES.length - 1 && (
                  <div className={`h-0.5 w-4 ${i < stageIndex ? "bg-success" : "bg-muted"}`} />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-muted flex flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="details" className="gap-2"><Package className="h-4 w-4" />Details</TabsTrigger>
          <TabsTrigger value="templates" className="gap-2"><Layers className="h-4 w-4" />Templates</TabsTrigger>
          <TabsTrigger value="print-orders" className="gap-2"><Printer className="h-4 w-4" />Print Orders</TabsTrigger>
          <TabsTrigger value="tasks" className="gap-2"><ListTodo className="h-4 w-4" />Project Tasks</TabsTrigger>
          <TabsTrigger value="files" className="gap-2"><FolderOpen className="h-4 w-4" />Project Files</TabsTrigger>
          <TabsTrigger value="data" className="gap-2"><Database className="h-4 w-4" />Project Data</TabsTrigger>
        </TabsList>

        {/* â”€â”€ DETAILS TAB â”€â”€ */}
        <TabsContent value="details" className="space-y-4">
          {/* Products Section */}
          <Card className="shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Products</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => {
                    const lines = ["Product,Spec,Qty,Unit Price,Total"];
                    products.forEach((p) =>
                      lines.push(`${p.productName},${p.spec},${p.quantity},${p.unitPrice},${p.quantity * p.unitPrice}`)
                    );
                    lines.push(`,,,,${productTotal}`);
                    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a"); a.href = url; a.download = `${project.id}-intent.csv`; a.click();
                    URL.revokeObjectURL(url);
                  }}>
                    <Download className="h-4 w-4 mr-1" />
                    Intent Letter
                  </Button>
                  <Dialog open={isAddProductOpen} onOpenChange={(o) => { setIsAddProductOpen(o); if (!o) { setProductForm(emptyProductForm); setProductErrors({}); } }}>
                    <DialogTrigger asChild>
                      <Button size="sm" className="gap-2">
                        <Plus className="h-4 w-4" />
                        Add Product
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle>Add Product to Project</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-2">
                        <div className="space-y-2">
                          <Label>Product Name <span className="text-destructive">*</span></Label>
                          <Select value={productForm.productName} onValueChange={(v) => setProductForm((f) => ({ ...f, productName: v }))}>
                            <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                            <SelectContent>
                              {PRODUCT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {productErrors.productName && <p className="text-xs text-destructive">{productErrors.productName}</p>}
                        </div>
                        <div className="space-y-2">
                          <Label>Specification / Variant</Label>
                          <Input placeholder="e.g. PVC Card Single Side (86×54mm)" value={productForm.spec} onChange={(e) => setProductForm((f) => ({ ...f, spec: e.target.value }))} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label>Quantity <span className="text-destructive">*</span></Label>
                            <Input type="number" min={1} placeholder="1" value={productForm.quantity} onChange={(e) => setProductForm((f) => ({ ...f, quantity: e.target.value }))} />
                            {productErrors.quantity && <p className="text-xs text-destructive">{productErrors.quantity}</p>}
                          </div>
                          <div className="space-y-2">
                            <Label>Unit Price (₹) <span className="text-destructive">*</span></Label>
                            <Input type="number" min={0} placeholder="0.00" value={productForm.unitPrice} onChange={(e) => setProductForm((f) => ({ ...f, unitPrice: e.target.value }))} />
                            {productErrors.unitPrice && <p className="text-xs text-destructive">{productErrors.unitPrice}</p>}
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => { setIsAddProductOpen(false); setProductForm(emptyProductForm); setProductErrors({}); }}>Cancel</Button>
                        <Button onClick={handleAddProduct}>Add Product</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {products.length === 0 ? (
                <div className="text-center py-10">
                  <Package className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No products added yet. Click "Add Product" to get started.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {products.map((p) => (
                    <div key={p.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-sm uppercase tracking-wide">{p.productName}</p>
                          {p.spec && <p className="text-sm text-muted-foreground mt-0.5">{p.spec}</p>}
                          <p className="text-xs text-muted-foreground mt-1">Qty: {p.quantity} × ₹{p.unitPrice.toLocaleString()}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="font-semibold">₹{(p.quantity * p.unitPrice).toLocaleString()}</p>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => { deleteProjectProduct(p.id); refresh(); }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t pt-3 mt-2">
                    <p className="font-semibold text-sm">Total</p>
                    <p className="font-bold text-lg">₹{productTotal.toLocaleString()}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Project Info */}
          <Card className="shadow-md">
            <CardHeader><CardTitle>Project Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Project Name</p>
                  <p className="font-medium mt-0.5">{project.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Client</p>
                  <p className="font-medium mt-0.5">{project.client}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Assignee</p>
                  <p className="font-medium mt-0.5">{project.assignee || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Priority</p>
                  <p className="font-medium mt-0.5 capitalize">{project.priority}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Due Date</p>
                  <p className="font-medium mt-0.5">{project.dueDate || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Created</p>
                  <p className="font-medium mt-0.5">{project.createdAt}</p>
                </div>
              </div>
              {project.description && (
                <div>
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="mt-0.5">{project.description}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TEMPLATES TAB ── */}
        <TabsContent value="templates">
          {/* Create New Template Dialog */}
          <Dialog open={isCreateTemplateOpen} onOpenChange={(o) => { setIsCreateTemplateOpen(o); if (!o) { setTemplateForm(emptyTemplateForm); setTemplateErrors({}); } }}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add new template</DialogTitle>
                <p className="text-sm text-muted-foreground">Fill in the details to create template.</p>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label>Template Name</Label>
                  <Input
                    placeholder="Template Name"
                    value={templateForm.templateName}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, templateName: e.target.value }))}
                    className={templateErrors.templateName ? "border-destructive" : ""}
                  />
                  {templateErrors.templateName && <p className="text-xs text-destructive">{templateErrors.templateName}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>Template Type</Label>
                  <Select value={templateForm.templateType} onValueChange={(v) => setTemplateForm((f) => ({ ...f, templateType: v as ProjectTemplate["templateType"] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Page Format</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["a4", "13x19", "custom"] as PageFormat[]).map((fmt) => {
                      const { width, height } = PAGE_FORMAT_SIZES[fmt];
                      const lbls: Record<PageFormat, string> = { a4: "Page: A4", "13x19": "Page: 13\u00d719", custom: "Custom" };
                      const subs: Record<PageFormat, string> = { a4: "297\u00d7210mm", "13x19": "330\u00d7482mm", custom: "Custom size" };
                      return (
                        <button
                          key={fmt}
                          onClick={() => setTemplateForm((f) => ({ ...f, pageFormat: fmt, canvas: { width, height } }))}
                          className={`rounded-lg border-2 p-3 text-left transition-colors ${templateForm.pageFormat === fmt ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"}`}
                        >
                          <div className="flex items-start gap-2">
                            <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${templateForm.pageFormat === fmt ? "border-primary" : "border-muted-foreground"}`}>
                              {templateForm.pageFormat === fmt && <div className="w-2 h-2 rounded-full bg-primary" />}
                            </div>
                            <div>
                              <p className="text-xs font-medium leading-tight">{lbls[fmt]}</p>
                              <p className="text-[10px] text-muted-foreground">{subs[fmt]}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {templateForm.pageFormat === "custom" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Width (mm)</Label>
                      <Input type="number" min={1} value={templateForm.canvas.width} onChange={(e) => updateTemplateCanvas("width", Number(e.target.value) || 1)} className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Height (mm)</Label>
                      <Input type="number" min={1} value={templateForm.canvas.height} onChange={(e) => updateTemplateCanvas("height", Number(e.target.value) || 1)} className="h-9" />
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Page margin (mm)</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {(["top", "left", "right", "bottom"] as (keyof typeof emptyTemplateForm.margin)[]).map((side) => (
                      <div key={side} className="space-y-1">
                        <Label className="text-xs capitalize">{side}</Label>
                        <Input type="number" min={0} value={templateForm.margin[side]} onChange={(e) => updateTemplateMargin(side, Number(e.target.value) || 0)} className="h-9" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Applicable for</Label>
                  <Input placeholder="e.g. All Students, Class 10, Staff..." value={templateForm.applicableFor} onChange={(e) => setTemplateForm((f) => ({ ...f, applicableFor: e.target.value }))} />
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium flex items-center gap-1.5">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                      Public template
                    </Label>
                    <p className="text-xs text-muted-foreground">Visible across all client projects in the system</p>
                  </div>
                  <Switch
                    checked={templateForm.isPublic}
                    onCheckedChange={(v) => setTemplateForm((f) => ({ ...f, isPublic: v }))}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setIsCreateTemplateOpen(false)}>Cancel</Button>
                  <Button onClick={handleCreateTemplate} disabled={isTemplateSaving}>
                    {isTemplateSaving ? "Saving..." : "Create Template"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Template Preview Dialog */}
          <Dialog open={!!previewTemplate} onOpenChange={(o) => { if (!o) setPreviewTemplate(null); }}>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Template Preview</DialogTitle></DialogHeader>
              {previewTemplate && (
                <div className="space-y-4">
                  <div className="bg-muted/40 rounded-lg p-4 flex items-center justify-center min-h-[200px]">
                    {canRenderSelectedTemplateImage ? (
                      <img
                        src={previewTemplate.thumbnail}
                        alt={previewTemplate.templateName}
                        className="max-w-full max-h-[320px] object-contain rounded shadow-md border border-border"
                        onError={() => markTemplatePreviewBroken(previewTemplate.id)}
                      />
                    ) : selectedPreviewTemplateDiagnostics?.hasDesignElements && previewTemplate.canvasJSON ? (
                      <TemplatePreviewCanvas
                        canvasJSON={previewTemplate.canvasJSON}
                        canvasConfig={previewTemplate.canvas}
                        maxWidth={352}
                        maxHeight={320}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                        <Layers className="h-8 w-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          {selectedPreviewTemplateDiagnostics?.fallbackMessage || "No preview available for this template."}
                        </p>
                      </div>
                    )}
                  </div>

                  {!selectedPreviewTemplateDiagnostics?.hasDesignElements && (
                    <p className="text-xs text-destructive bg-destructive/10 rounded px-2.5 py-2">
                      No preview available. Please configure the template.
                    </p>
                  )}

                  {Boolean(selectedPreviewTemplateDiagnostics?.missingFieldKeys.length) && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-start gap-2.5">
                      <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-amber-800">Some fields need mapping</p>
                        <p className="text-xs text-amber-700 mt-0.5">
                          {selectedPreviewTemplateDiagnostics!.missingFieldKeys.length} field{selectedPreviewTemplateDiagnostics!.missingFieldKeys.length > 1 ? "s" : ""} in this template are not connected to your data source yet.
                        </p>
                        <button
                          className="text-xs font-medium text-amber-800 underline underline-offset-2 mt-1"
                          onClick={() => id && navigate(`/projects/${id}/rule-builder`)}
                        >
                          Set up field mapping →
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="font-medium capitalize">{previewTemplate.templateType.replace("_"," ")}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Canvas</span><span className="font-medium">{previewTemplate.canvas.width} x {previewTemplate.canvas.height} mm</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Margin T/L/R/B</span><span className="font-medium">{previewTemplate.margin.top}/{previewTemplate.margin.left}/{previewTemplate.margin.right}/{previewTemplate.margin.bottom} mm</span></div>
                    {previewTemplate.applicableFor && <div className="flex justify-between"><span className="text-muted-foreground">For</span><span className="font-medium">{previewTemplate.applicableFor}</span></div>}
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* ── Remove-from-project confirmation dialog ── */}
          <Dialog open={!!deleteConfirmTemplate} onOpenChange={(open) => { if (!open && !isDeletingTemplate) setDeleteConfirmTemplate(null); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <Trash2 className="h-4 w-4" /> Remove Template
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Remove{" "}
                <strong className="font-medium text-foreground">"{deleteConfirmTemplate?.templateName}"</strong>{" "}
                from this project? This only removes it from the project — it won't affect the Template Gallery.
              </p>
              <div className="flex justify-end gap-2 mt-2">
                <Button variant="outline" size="sm" disabled={isDeletingTemplate} onClick={() => setDeleteConfirmTemplate(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isDeletingTemplate}
                  onClick={() => deleteConfirmTemplate && void handleDeleteTemplate(deleteConfirmTemplate)}
                >
                  {isDeletingTemplate ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Removing…</> : "Remove"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Card className="shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle>Project Templates</CardTitle>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() => id && navigate(`/template-gallery?projectId=${id}`)}
                  >
                    <Globe className="h-4 w-4" />Open Template Gallery
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={handleOpenGeneratePreview}
                    disabled={previewTemplateGroups.projectTemplates.length === 0}
                  >
                    <Settings2 className="h-4 w-4" />Generate Preview
                  </Button>
                  <Button size="sm" className="gap-2" onClick={() => setIsCreateTemplateOpen(true)}>
                    <Plus className="h-4 w-4" />Create new template
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {remoteTemplatesError && (
                <div className="mb-3 flex items-center gap-2 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{remoteTemplatesError}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 px-2 text-xs text-yellow-800 hover:bg-yellow-100"
                    onClick={() => { setRemoteTemplatesError(""); refetchTemplates(); }}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {remoteTemplatesLoading && previewTemplates.length === 0 ? (
                <div className="text-center py-12">
                  <Loader2 className="h-8 w-8 mx-auto text-muted-foreground mb-3 animate-spin" />
                  <p className="text-muted-foreground text-sm">Loading templates…</p>
                </div>
              ) : previewTemplateGroups.projectTemplates.length === 0 ? (
                <div className="text-center py-12">
                  <Layers className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">No templates attached to this project yet</p>
                  <p className="text-sm text-muted-foreground mb-4">Use Template Gallery to browse and attach public templates.</p>
                  <div className="flex gap-2 justify-center">
                    <Button variant="outline" onClick={() => id && navigate(`/template-gallery?projectId=${id}`)}>Browse Template Gallery</Button>
                    <Button variant="outline" onClick={() => setIsCreateTemplateOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />Create new template
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {previewTemplateGroups.projectTemplates.map((tmpl) => {
                    const previewDiagnostics = templateDiagnosticsMap[tmpl.id];
                    const showThumbnail = Boolean(tmpl.thumbnail && !brokenTemplatePreviewIds[tmpl.id]);
                    // Blank card shape SVG so cards always look like cards, not error states
                    const w = tmpl.canvas.width || 54;
                    const h = tmpl.canvas.height || 86;
                    const blankPlaceholder = `data:image/svg+xml,${encodeURIComponent(
                      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
                      `<rect width="${w}" height="${h}" rx="2" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>` +
                      `<text x="${w/2}" y="${h * 0.45}" font-family="sans-serif" font-size="${Math.max(5, Math.min(w,h)*0.1)}" fill="#94a3b8" text-anchor="middle" dominant-baseline="middle">No Design Yet</text>` +
                      `<text x="${w/2}" y="${h * 0.62}" font-family="sans-serif" font-size="${Math.max(4, Math.min(w,h)*0.08)}" fill="#cbd5e1" text-anchor="middle" dominant-baseline="middle">${w}\xd7${h}mm</text>` +
                      `</svg>`
                    )}`;
                    // Own project's template (has edit/delete rights)
                    const isOwnTemplate = tmpl.projectId === id;

                    return (
                      <div key={tmpl.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow space-y-3">
                        <div className="bg-muted/30 rounded flex items-center justify-center h-28 relative overflow-hidden">
                          {showThumbnail ? (
                            <img
                              src={tmpl.thumbnail}
                              alt={tmpl.templateName}
                              className="max-h-full max-w-full object-contain rounded shadow"
                              onError={() => markTemplatePreviewBroken(tmpl.id)}
                            />
                          ) : (
                            <img
                              src={blankPlaceholder}
                              alt={`${tmpl.templateName} — no design yet`}
                              className="max-h-full max-w-full object-contain rounded"
                            />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-sm truncate">{tmpl.templateName}</p>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            <Badge variant="secondary" className="text-[10px] capitalize">{tmpl.templateType.replace("_"," ")}</Badge>
                            <Badge variant="outline" className="text-[10px]">{tmpl.canvas.width}x{tmpl.canvas.height}mm</Badge>
                          </div>
                          {!previewDiagnostics?.hasDesignElements && (
                            <Badge variant="outline" className="text-[10px] mt-1 text-muted-foreground border-dashed">
                              Draft
                            </Badge>
                          )}
                          {Boolean(previewDiagnostics?.missingFieldKeys.length) && (
                            <Badge variant="outline" className="text-[10px] mt-1 text-amber-700 border-amber-300 bg-amber-50 gap-1">
                              <AlertTriangle className="h-2.5 w-2.5" />Needs Setup
                            </Badge>
                          )}
                          {tmpl.applicableFor && <p className="text-xs text-muted-foreground mt-1 truncate">For: {tmpl.applicableFor}</p>}
                          <p className="text-xs text-muted-foreground">{tmpl.createdAt}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="flex-1 text-xs gap-1" onClick={() => setPreviewTemplate(tmpl)}>
                            <Download className="h-3 w-3" />Preview
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 text-xs gap-1 text-primary hover:text-primary"
                            onClick={() => {
                              const rawMargin = (tmpl as any).margin ?? {};
                              const normalizedMargin = {
                                top: Number(rawMargin.top ?? (tmpl as any).marginTop ?? 0) || 0,
                                left: Number(rawMargin.left ?? (tmpl as any).marginLeft ?? 0) || 0,
                                right: Number(rawMargin.right ?? (tmpl as any).marginRight ?? 0) || 0,
                                bottom: Number(rawMargin.bottom ?? (tmpl as any).marginBottom ?? 0) || 0,
                              };
                              const designerConfig = {
                                templateName: tmpl.templateName,
                                templateType: tmpl.templateType,
                                canvas: tmpl.canvas,
                                margin: normalizedMargin,
                              };
                              localStorage.setItem("vendor_designer_template_config", JSON.stringify(designerConfig));
                              localStorage.setItem(DESIGNER_CONTEXT_KEY, JSON.stringify({
                                projectId: project.id,
                                templateId: tmpl.id,
                                projectName: project.name,
                                templateName: tmpl.templateName,
                              }));
                              navigate("/designer-studio");
                            }}
                          >
                            <Pencil className="h-3 w-3" />Edit
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost" className="px-2">
                                <MoreVertical className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[170px]">
                              <DropdownMenuItem
                                className="gap-2 text-xs cursor-pointer"
                                onClick={() => {
                                  const rawMargin = (tmpl as any).margin ?? {};
                                  const normalizedMargin = {
                                    top: Number(rawMargin.top ?? (tmpl as any).marginTop ?? 0) || 0,
                                    left: Number(rawMargin.left ?? (tmpl as any).marginLeft ?? 0) || 0,
                                    right: Number(rawMargin.right ?? (tmpl as any).marginRight ?? 0) || 0,
                                    bottom: Number(rawMargin.bottom ?? (tmpl as any).marginBottom ?? 0) || 0,
                                  };
                                  localStorage.setItem("vendor_designer_template_config", JSON.stringify({
                                    templateName: tmpl.templateName,
                                    templateType: tmpl.templateType,
                                    canvas: tmpl.canvas,
                                    margin: normalizedMargin,
                                  }));
                                  localStorage.setItem(DESIGNER_CONTEXT_KEY, JSON.stringify({
                                    projectId: project.id,
                                    templateId: tmpl.id,
                                    projectName: project.name,
                                    templateName: tmpl.templateName,
                                  }));
                                  navigate("/designer-studio");
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" /> Edit in Designer
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="gap-2 text-xs cursor-pointer"
                                onClick={() => setPreviewTemplate(tmpl)}
                              >
                                <Download className="h-3.5 w-3.5" /> Preview
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="gap-2 text-xs text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
                                onClick={() => setDeleteConfirmTemplate(tmpl)}
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Remove from Project
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* â”€â”€ PRINT ORDERS TAB â”€â”€ */}
        <TabsContent value="print-orders">
          <Card className="shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Print Orders</CardTitle>
                <Button size="sm" className="gap-2" onClick={() => {
                  if (products.length === 0) {
                    alert("Add products to the project first before creating a print order.");
                    return;
                  }
                  handleStageChange("printing");
                }}>
                  <Printer className="h-4 w-4" />
                  Create Print Order
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {project.stage === "printing" || project.stage === "dispatched" || project.stage === "delivered" ? (
                <div className="space-y-4">
                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold">Print Order #{project.id}</p>
                        <p className="text-xs text-muted-foreground">Created {project.createdAt}</p>
                      </div>
                      <Badge className={
                        project.stage === "delivered" ? "bg-success text-success-foreground" :
                        project.stage === "dispatched" ? "bg-blue-500 text-white" :
                        "bg-orange-500 text-white"
                      }>
                        {STAGE_LABELS[project.stage]}
                      </Badge>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>Spec</TableHead>
                          <TableHead>Qty</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {products.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="font-medium">{p.productName}</TableCell>
                            <TableCell className="text-muted-foreground">{p.spec}</TableCell>
                            <TableCell>{p.quantity}</TableCell>
                            <TableCell className="text-right">₹{(p.quantity * p.unitPrice).toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell colSpan={3} className="font-bold">Total</TableCell>
                          <TableCell className="text-right font-bold">₹{productTotal.toLocaleString()}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Printer className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-2">No print orders yet</p>
                  <p className="text-xs text-muted-foreground">Add products and click "Create Print Order" to begin printing</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* â”€â”€ PROJECT TASKS TAB â”€â”€ */}
        <TabsContent value="tasks">
          <Card className="shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Project Tasks</CardTitle>
                <Dialog open={isAddTaskOpen} onOpenChange={(o) => { setIsAddTaskOpen(o); if (!o) { setTaskForm(emptyTaskForm); setTaskErrors({}); setEditingTask(null); } }}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-2"><Plus className="h-4 w-4" />Add Task</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>{editingTask ? "Edit Task" : "Add Task"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <div className="space-y-2">
                        <Label>Task Title <span className="text-destructive">*</span></Label>
                        <Input placeholder="Task description" value={taskForm.title} onChange={(e) => setTaskForm((f) => ({ ...f, title: e.target.value }))} />
                        {taskErrors.title && <p className="text-xs text-destructive">{taskErrors.title}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>Assignee</Label>
                        <Input placeholder="Name" value={taskForm.assignee} onChange={(e) => setTaskForm((f) => ({ ...f, assignee: e.target.value }))} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Due Date</Label>
                          <Input type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm((f) => ({ ...f, dueDate: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Status</Label>
                          <Select value={taskForm.status} onValueChange={(v) => setTaskForm((f) => ({ ...f, status: v as ProjectTask["status"] }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="in-progress">In Progress</SelectItem>
                              <SelectItem value="done">Done</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="outline" onClick={() => { setIsAddTaskOpen(false); setTaskForm(emptyTaskForm); setTaskErrors({}); setEditingTask(null); }}>Cancel</Button>
                      <Button onClick={handleAddTask}>{editingTask ? "Save Changes" : "Add Task"}</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <div className="text-center py-12">
                  <ListTodo className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No tasks yet. Add tasks to track project progress.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {tasks.map((t) => (
                    <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                      <button onClick={() => toggleTaskStatus(t)} className="flex-shrink-0">
                        {t.status === "done" ? (
                          <CheckCircle2 className="h-5 w-5 text-success" />
                        ) : t.status === "in-progress" ? (
                          <Clock className="h-5 w-5 text-warning" />
                        ) : (
                          <Circle className="h-5 w-5 text-muted-foreground" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-sm ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                          {t.title}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5">
                          {t.assignee && <span className="text-xs text-muted-foreground">{t.assignee}</span>}
                          {t.dueDate && <span className="text-xs text-muted-foreground">Due: {t.dueDate}</span>}
                        </div>
                      </div>
                      <Badge variant={t.status === "done" ? "default" : t.status === "in-progress" ? "secondary" : "outline"} className="text-xs">
                        {t.status === "in-progress" ? "In Progress" : t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                      </Badge>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditTask(t)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => { deleteProjectTask(t.id); refresh(); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    {tasks.filter((t) => t.status === "done").length} of {tasks.length} completed
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* â”€â”€ PROJECT FILES TAB â”€â”€ */}
        <TabsContent value="files">
          <Card className="shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Project Files</CardTitle>
                <Button size="sm" className="gap-2" onClick={() => {
                  setAddFileState({ file: null, name: "", category: "other" });
                  setIsAddFileOpen(true);
                }}>
                  <Plus className="h-4 w-4" />
                  Add File
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {files.filter((f) => f.category === "other" || f.category === "print").length === 0 && files.filter((f) => f.category === "template").length === 0 && files.filter((f) => f.category === "data").length === 0 ? (
                <div
                  className="border-2 border-dashed rounded-lg p-12 text-center hover:border-secondary transition-colors cursor-pointer"
                  onClick={() => {
                    setAddFileState({ file: null, name: "", category: "other" });
                    setIsAddFileOpen(true);
                  }}
                >
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">Click to upload or drag and drop files here</p>
                  <p className="text-xs text-muted-foreground mt-1">Any file type supported</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            {f.name}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">{f.category}</Badge>
                        </TableCell>
                        <TableCell>{f.size}</TableCell>
                        <TableCell>{f.uploadedAt}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => { deleteProjectFile(f.id); refresh(); }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* ── Add File Dialog ── */}
          <Dialog open={isAddFileOpen} onOpenChange={(open) => {
            setIsAddFileOpen(open);
            if (!open) setAddFileState({ file: null, name: "", category: "other" });
          }}>
            <DialogContent className="sm:max-w-[460px]">
              <DialogHeader>
                <DialogTitle>Add New File</DialogTitle>
              </DialogHeader>

              {/* Step 1: Choose file */}
              {!addFileState.file ? (
                <div
                  className="mt-2 border-2 border-dashed rounded-lg p-10 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-primary hover:bg-muted/40 transition-colors"
                  onClick={() => addFileDialogInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) setAddFileState({ file: f, name: f.name, category: "other" });
                  }}
                >
                  <FilePlus className="h-10 w-10 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-medium">Click to choose a file</p>
                    <p className="text-xs text-muted-foreground mt-1">or drag and drop here</p>
                  </div>
                  <input
                    ref={addFileDialogInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleAddFileDialogSelect}
                  />
                </div>
              ) : (
                /* Step 2: Fill in name & type, then upload */
                <div className="mt-2 space-y-4">
                  {/* Selected file preview */}
                  <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/40">
                    <FileText className="h-8 w-8 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{addFileState.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(addFileState.file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      title="Remove selected file"
                      onClick={() => setAddFileState({ file: null, name: "", category: "other" })}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Name */}
                  <div className="space-y-1.5">
                    <Label htmlFor="add-file-name">File Name</Label>
                    <Input
                      id="add-file-name"
                      value={addFileState.name}
                      onChange={(e) => setAddFileState((s) => ({ ...s, name: e.target.value }))}
                      placeholder="Enter file name"
                    />
                  </div>

                  {/* File Type */}
                  <div className="space-y-1.5">
                    <Label>File Type</Label>
                    <Select
                      value={addFileState.category}
                      onValueChange={(v) => setAddFileState((s) => ({ ...s, category: v as ProjectFile["category"] }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select file type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="other">General / Other</SelectItem>
                        <SelectItem value="print">Print File</SelectItem>
                        <SelectItem value="template">Template</SelectItem>
                        <SelectItem value="data">Data File</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 pt-1">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setIsAddFileOpen(false);
                        setAddFileState({ file: null, name: "", category: "other" });
                      }}
                    >
                      Cancel
                    </Button>
                    <Button className="flex-1 gap-2" onClick={handleAddFileSubmit}>
                      <Upload className="h-4 w-4" />
                      Add File
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* â”€â”€ PROJECT DATA TAB â”€â”€ */}
        <TabsContent value="data">
          <div className="space-y-4">

            {/* Sub-tabs: Data / Groups / Fields */}
            <div className="flex items-center gap-6 border-b pb-0">
              {(["data", "groups", "fields"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDataSubTab(tab)}
                  className={`pb-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                    dataSubTab === tab
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Category toggle: Staff / Student */}
            <div className="flex gap-2">
              {(["staff", "student"] as const).map((cat) => (
                <Button
                  key={cat}
                  variant={dataCategory === cat ? "default" : "outline"}
                  size="sm"
                  className="capitalize"
                  onClick={() => switchDataCategory(cat)}
                >
                  {cat}
                </Button>
              ))}
            </div>

            {/* ── DATA sub-tab ── */}
            {dataSubTab === "data" && (
              <div className="space-y-4">
                {(dataRecords.length === 0 || showImportWizard) ? (
                  <BulkImportWizard
                    projectId={id ?? ""}
                    category={dataCategory}
                    onComplete={(fields, records) => {
                      if (!id) return;
                      saveDataFields(id, dataCategory, fields);
                      saveDataRecords(id, dataCategory, records);
                      setDataFields(fields);
                      setDataRecords(records);
                      setShowImportWizard(false);
                      // Persist imported records to backend for cross-device / post-refresh access
                      void saveProjectRecords(id, dataCategory, toDbSafeRecords(records));
                    }}
                    onCancel={dataRecords.length > 0 ? () => setShowImportWizard(false) : undefined}
                  />
                ) : (
                  <Card className="shadow-sm">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="text-xs">
                            Total Records: {filteredRecords.length}
                          </Badge>
                          {dataSelectedIds.size > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              {dataSelectedIds.size} selected
                            </Badge>
                          )}
                          {aiProcessing && (
                            <Badge variant="default" className="text-xs gap-1.5">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {aiProcessing === "autocrop" ? "Auto-cropping…" : "Removing background…"}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="Search…"
                            value={dataFilter}
                            onChange={(e) => setDataFilter(e.target.value)}
                            className="h-8 text-xs w-48"
                          />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 text-xs h-8"
                                disabled={dataSelectedIds.size === 0}
                              >
                                <FileText className="h-3.5 w-3.5" />
                                Selected Actions
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem onClick={handleOpenGeneratePreview} disabled={dataSelectedIds.size === 0}>
                                <Download className="h-4 w-4 mr-2" /> Generate preview
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={deleteSelected}
                                disabled={dataSelectedIds.size === 0}
                              >
                                <Trash2 className="h-4 w-4 mr-2" /> Delete selected records
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
                            <Filter className="h-3.5 w-3.5" />
                            Filter
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
                                <MoreHorizontal className="h-3.5 w-3.5" />
                                Actions
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem onClick={() => setShowImportWizard(true)}>
                                <Upload className="h-4 w-4 mr-2" /> Import Data
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={handleDownloadExcel} disabled={!filteredRecords.length}>
                                <FileDown className="h-4 w-4 mr-2" /> Download Excel
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void handleDownloadImageZip()} disabled={!filteredRecords.some((r) => Boolean(getRecordPhoto(r)))}>
                                <Archive className="h-4 w-4 mr-2" /> Download Image Zip
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={handleOpenAddData} disabled={!dataFields.length}>
                                <UserPlus className="h-4 w-4 mr-2" /> Add Data
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setBulkEditField(""); setBulkEditValue(""); setIsBulkEditOpen(true); }}>
                                <Edit className="h-4 w-4 mr-2" /> Bulk Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => void handleAIAutoCrop()} disabled={!!aiProcessing}>
                                {aiProcessing === "autocrop"
                                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  : <Crop className="h-4 w-4 mr-2" />}
                                AI Image Auto Crop
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void handleAIBgRemove()} disabled={!!aiProcessing}>
                                {aiProcessing === "bgremove"
                                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  : <Wand2 className="h-4 w-4 mr-2" />}
                                AI Image Background Remover
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={handleResetPhoto}>
                                <RotateCcw className="h-4 w-4 mr-2" /> Reset Photo
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setImageUploadTarget("selection"); photoUploadRef.current?.click(); }}>
                                <ImageIcon className="h-4 w-4 mr-2" /> Image Upload
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setBulkImageResults(null); setIsBulkImageUploadOpen(true); }} disabled={!dataRecords.length}>
                                <Archive className="h-4 w-4 mr-2" /> Bulk Image Upload
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => { setBarcodeField(dataFields[0]?.key ?? ""); setIsGenerateBarcodeOpen(true); }}>
                                <QrCode className="h-4 w-4 mr-2" /> Generate Bar Code
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={handleOpenAddData} disabled={!dataFields.length}>
                                <UserRound className="h-4 w-4 mr-2" /> Add New User
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setIsDeleteAllOpen(true)}
                                disabled={!dataRecords.length}
                              >
                                <Trash2 className="h-4 w-4 mr-2" /> Delete All {dataCategory} Data
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10">
                                <input
                                  type="checkbox"
                                  checked={dataSelectedIds.size === filteredRecords.length && filteredRecords.length > 0}
                                  onChange={toggleSelectAll}
                                  className="rounded"
                                />
                              </TableHead>
                              <TableHead className="w-12">S.No.</TableHead>
                              <TableHead>Name</TableHead>
                              {dataFields
                                .filter((f) => f.key !== "Name" && f.key !== "name" && !isPhotoFieldKey(f.key))
                                .slice(0, 8)
                                .map((f) => (
                                  <TableHead key={f.key}>{f.label}</TableHead>
                                ))}
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredRecords.map((rec, idx) => {
                              const resolvedUrl = getRecordPhotoUrl(rec);
                              const imageUrl = resolvedUrl || DEFAULT_AVATAR;
                              const nameVal = String(rec["Name"] ?? rec["name"] ?? "—");
                              const isChecked = dataSelectedIds.has(rec.id);
                              return (
                                <TableRow key={rec.id} className={isChecked ? "bg-muted/50" : ""}>
                                  <TableCell>
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => {
                                        setDataSelectedIds((prev) => {
                                          const next = new Set(prev);
                                          next.has(rec.id) ? next.delete(rec.id) : next.add(rec.id);
                                          return next;
                                        });
                                      }}
                                      className="rounded"
                                    />
                                  </TableCell>
                                  <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-2.5">
                                      <img
                                        src={imageUrl}
                                        alt={nameVal}
                                        className="h-9 w-9 rounded-full object-cover shrink-0"
                                        onError={(event) => {
                                          const img = event.currentTarget;
                                          img.onerror = null;
                                          img.src = DEFAULT_AVATAR;
                                        }}
                                      />
                                      <div>
                                        <p className="text-sm font-medium leading-none">{nameVal}</p>
                                        {rec.groupId && (
                                          <Badge variant="secondary" className="text-[10px] mt-0.5 h-4">
                                            {dataGroups.find((g) => g.id === rec.groupId)?.name ?? ""}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  </TableCell>
                                  {dataFields
                                    .filter((f) => f.key !== "Name" && f.key !== "name" && !isPhotoFieldKey(f.key))
                                    .slice(0, 8)
                                    .map((f) => (
                                      <TableCell key={f.key} className="text-sm">
                                        {String(rec[f.key] ?? "—")}
                                      </TableCell>
                                    ))}
                                  <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                        title="Upload photo"
                                        onClick={() => {
                                          setImageUploadTarget(rec.id);
                                          photoUploadRef.current?.click();
                                        }}
                                      >
                                        <Camera className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-destructive hover:text-destructive"
                                        onClick={() => {
                                          if (!id) return;
                                          deleteDataRecord(rec.id);
                                          setDataRecords(loadDataRecords(id, dataCategory));
                                        }}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                      <input
                        ref={photoUploadRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleImageUploadFiles}
                      />
                      {/* Bulk image upload — folder */}
                      <input
                        ref={bulkImageFolderRef}
                        type="file"
                        accept="image/*"
                        multiple
                        // @ts-expect-error webkitdirectory is non-standard
                        webkitdirectory=""
                        className="hidden"
                        onChange={handleBulkImageFolderChange}
                      />
                      {/* Bulk image upload — ZIP */}
                      <input
                        ref={bulkImageZipRef}
                        type="file"
                        accept=".zip,application/zip,application/x-zip-compressed"
                        className="hidden"
                        onChange={handleBulkImageZipChange}
                      />
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* ── GROUPS sub-tab ── */}
            {dataSubTab === "groups" && (
              <Card className="shadow-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Groups
                      <Badge variant="outline">{dataGroups.length}</Badge>
                    </CardTitle>
                    <Button size="sm" className="gap-1.5 text-xs" onClick={() => setIsAddGroupOpen(true)}>
                      <Plus className="h-3.5 w-3.5" /> Add Group
                    </Button>
                  </div>
                  {templates.length === 0 && (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 mt-2">
                      No templates found for this project. Go to the <strong>Templates</strong> tab to create one first.
                    </p>
                  )}
                </CardHeader>
                <CardContent>
                  {dataGroups.length === 0 ? (
                    <div className="border-2 border-dashed rounded-lg p-10 text-center text-muted-foreground">
                      <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm font-medium">No groups yet</p>
                      <p className="text-xs mt-1">Create a group and assign a template to organise records for printing.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {dataGroups.map((g) => {
                        const assignedTemplate = templates.find((t) => t.id === g.templateId);
                        const recordCount = dataRecords.filter((r) => r.groupId === g.id).length;
                        const appliedFilters = [
                          { label: "Class", value: g.classFilter },
                          { label: "Gender", value: g.genderFilter },
                          { label: "Transport", value: g.transportFilter },
                          { label: "Boarding", value: g.boardingFilter },
                          { label: "House", value: g.houseFilter },
                        ].filter((item) => Boolean(item.value));
                        return (
                          <div key={g.id} className="flex items-center gap-3 px-3 py-3 rounded-lg border bg-muted/30">
                            <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />

                            {/* Group name + record count */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium">{g.name}</span>
                                <Badge variant="secondary" className="text-xs">
                                  {recordCount} {recordCount === 1 ? "record" : "records"}
                                </Badge>
                              </div>

                              {appliedFilters.length > 0 && (
                                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                  {appliedFilters.map((item) => (
                                    <Badge key={`${g.id}-${item.label}`} variant="outline" className="text-[10px] h-5">
                                      {item.label}: {item.value}
                                    </Badge>
                                  ))}
                                </div>
                              )}

                              {/* Template selector per group */}
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <Select
                                  value={g.templateId ?? "__none__"}
                                  onValueChange={(val) => handleGroupTemplateChange(g.id, val === "__none__" ? "" : val)}
                                >
                                  <SelectTrigger className="h-6 text-xs w-48 border-dashed">
                                    <SelectValue placeholder="Assign template…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">No template</SelectItem>
                                    {templates.map((t) => (
                                      <SelectItem key={t.id} value={t.id}>
                                        {t.templateName}
                                        <span className="ml-1.5 text-muted-foreground text-[10px]">({t.templateType})</span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {assignedTemplate && (
                                  <Badge variant="outline" className="text-[10px] h-5 gap-1 border-primary/40 text-primary">
                                    <Layers className="h-2.5 w-2.5" />
                                    {assignedTemplate.templateName}
                                  </Badge>
                                )}
                              </div>
                            </div>

                            {/* Delete */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                              onClick={() => {
                                deleteDataGroup(g.id);
                                setDataGroups((prev) => prev.filter((x) => x.id !== g.id));
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── FIELDS sub-tab ── */}
            {dataSubTab === "fields" && (
              <Card className="shadow-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <GripVertical className="h-4 w-4" />
                      Fields
                      <Badge variant="outline">{dataFields.length}</Badge>
                    </CardTitle>
                    <Button
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => {
                        setEditFieldsDraft(dataFields.length ? [...dataFields] : [{ key: "Name", label: "Name" }]);
                        setIsEditFieldsOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit Fields
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {dataFields.length === 0 ? (
                    <div className="border-2 border-dashed rounded-lg p-10 text-center text-muted-foreground">
                      <Settings2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">No fields defined. Upload a CSV or edit fields manually.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {dataFields.map((f, i) => (
                        <div key={f.key} className="flex items-center gap-3 px-3 py-2 rounded-lg border bg-muted/30">
                          <span className="text-xs text-muted-foreground w-5">{i + 1}</span>
                          <span className="text-sm font-medium flex-1">{f.label}</span>
                          <Badge variant="outline" className="text-xs font-mono">{f.key}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── Generate Preview Dialog ── */}
          <Dialog open={isGeneratePreviewOpen} onOpenChange={(open) => {
            if (!open && isGeneratingPreview) {
              // User closed dialog mid-generation — abort any in-progress work.
              abortRef.current?.abort();
              return;
            }
            setIsGeneratePreviewOpen(open);
            if (!open) {
              setPreviewError("");
              setPreviewProgressText("");
              setPreviewDialogStep(1);
            }
          }}>
            <DialogContent className="sm:max-w-[620px]">
              <DialogHeader>
                <DialogTitle>Generate Preview</DialogTitle>
              </DialogHeader>

              {/* ── STEP 1: Select Template ── */}
              {previewDialogStep === 1 && (
                <div className="space-y-4 py-1">
                  <p className="text-sm text-muted-foreground">
                    Select a template attached to this project to use for generating the preview PDF.
                  </p>
                  <div className="space-y-1.5">
                    <Label>Select template</Label>
                    {previewTemplateGroups.projectTemplates.length === 0 ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        No templates attached to this project yet.{" "}
                        <button
                          className="font-medium underline underline-offset-2"
                          onClick={() => { setIsGeneratePreviewOpen(false); id && navigate(`/template-gallery?projectId=${id}`); }}
                        >
                          Open Template Gallery →
                        </button>
                      </div>
                    ) : (
                      <Select
                        value={previewForm.templateId || "__none__"}
                        onValueChange={(value) => {
                          const sel = previewTemplates.find((t) => t.id === value);
                          setPreviewForm((prev) => ({
                            ...prev,
                            templateId: value === "__none__" ? "" : value,
                            templateType: sel?.templateType || prev.templateType,
                            orientation: sel?.canvas?.width && sel?.canvas?.height
                              ? (sel.canvas.width > sel.canvas.height ? "landscape" : "portrait")
                              : prev.orientation,
                          }));
                        }}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Choose an attached template…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Choose a template…</SelectItem>
                          {previewTemplateGroups.projectTemplates.map((template) => (
                            <SelectItem key={template.id} value={template.id}>
                              {template.templateName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  {previewForm.templateId && (
                    <div className="sm:col-span-2 space-y-1.5">
                      <Label>Template preview</Label>
                      <IdCardGrid students={selectedRecords.slice(0, 3)} template={previewTemplates.find((t) => t.id === previewForm.templateId) ?? null} />
                    </div>
                  )}
                  {previewError && <p className="text-sm text-destructive">{previewError}</p>}
                  <div className="flex gap-3 pt-1">
                    <Button variant="outline" className="flex-1" onClick={() => setIsGeneratePreviewOpen(false)}>Cancel</Button>
                    <Button
                      className="flex-1 gap-1.5"
                      disabled={!previewForm.templateId}
                      onClick={() => {
                        if (!selectedRecords.length) {
                          setPreviewError("No records selected. Go to Project Data tab and select records first.");
                          return;
                        }
                        setPreviewError("");
                        setPreviewDialogStep(2);
                      }}
                    >
                      Configure &amp; Generate →
                    </Button>
                  </div>
                </div>
              )}

              {/* ── STEP 2: Full generation form ── */}
              {previewDialogStep === 2 && (
                <div className="space-y-4 py-1">
                  <div className="flex items-center gap-3 text-sm flex-wrap">
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                      onClick={() => { setPreviewError(""); setPreviewDialogStep(1); }}
                    >
                      ← Change template
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">
                      Generating for <strong className="text-foreground">{selectedRecords.length}</strong> selected record(s)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Page size</Label>
                      <Select
                        value={previewForm.pageSize}
                        onValueChange={(value) => {
                          const size = value as PreviewPageSize;
                          setPreviewForm((prev) => {
                            if (size === "Custom") {
                              return { ...prev, pageSize: size };
                            }
                            const dims = PAGE_SIZE_DIMENSIONS[size];
                            return {
                              ...prev,
                              pageSize: size,
                              sheetWidthMm: String(dims.width),
                              sheetHeightMm: String(dims.height),
                            };
                          });
                        }}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select page size" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="A4">A4</SelectItem>
                          <SelectItem value="A3">A3</SelectItem>
                          <SelectItem value="Letter">Letter</SelectItem>
                          <SelectItem value="Legal">Legal</SelectItem>
                          <SelectItem value="Custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Selected template</Label>
                      <div className="h-9 flex items-center px-3 rounded-md border border-input bg-muted/40 text-sm">
                        {previewTemplates.find((t) => t.id === previewForm.templateId)?.templateName || "—"}
                      </div>
                    </div>

                    <div className="sm:col-span-2 space-y-1.5">
                      <Label>Rendered template preview</Label>
                      <IdCardGrid students={selectedRecords} template={selectedGenerateTemplate} />
                      {selectedRecords.length > 1 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Showing first 10 of {selectedRecords.length} student(s). PDF will include all.
                        </p>
                      )}
                    </div>

                    {/* Missing images warning */}
                    {missingPhotosCount > 0 && (
                      <div className="sm:col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                        <p className="text-xs font-medium text-amber-800">
                          ⚠ {missingPhotosCount} of {selectedRecords.length} student{missingPhotosCount !== 1 ? "s" : ""} {missingPhotosCount !== 1 ? "have" : "has"} no photo.
                          Upload a ZIP to map images, or "No Image" placeholders will appear in the PDF.
                        </p>
                      </div>
                    )}

                    {selectedGenerateTemplateDiagnostics && (
                      <div className="sm:col-span-2 space-y-1">
                        {!selectedGenerateTemplateDiagnostics.hasDesignElements && (
                          <p className="text-xs text-destructive">
                            No preview available. Please configure the template.
                          </p>
                        )}
                        {selectedGenerateTemplateDiagnostics.missingFieldKeys.length > 0 && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-start gap-2.5">
                            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-amber-800">
                                {selectedGenerateTemplateDiagnostics.missingFieldKeys.length} field{selectedGenerateTemplateDiagnostics.missingFieldKeys.length > 1 ? "s" : ""} not mapped
                              </p>
                              <p className="text-xs text-amber-700 mt-0.5">
                                The preview may show placeholder text for unmapped fields. You can still generate.
                              </p>
                              <button
                                className="text-xs font-medium text-amber-800 underline underline-offset-2 mt-1"
                                onClick={() => id && navigate(`/projects/${id}/rule-builder`)}
                              >
                                Fix in Rule Builder →
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label>Orientation</Label>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant={previewForm.orientation === "portrait" ? "default" : "outline"}
                          className="h-9 flex-1"
                          onClick={() => setPreviewForm((prev) => ({ ...prev, orientation: "portrait" }))}
                        >
                          Portrait
                        </Button>
                        <Button
                          type="button"
                          variant={previewForm.orientation === "landscape" ? "default" : "outline"}
                          className="h-9 flex-1"
                          onClick={() => setPreviewForm((prev) => ({ ...prev, orientation: "landscape" }))}
                        >
                          Landscape
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Template type</Label>
                      <Select
                        value={previewForm.templateType}
                        onValueChange={(value) => setPreviewForm((prev) => ({ ...prev, templateType: value as ProjectTemplate["templateType"] }))}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select template type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="id_card">ID Card</SelectItem>
                          <SelectItem value="certificate">Certificate</SelectItem>
                          <SelectItem value="poster">Poster</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Is sample</Label>
                      <Select value={previewForm.isSample} onValueChange={(value) => setPreviewForm((prev) => ({ ...prev, isSample: value as "yes" | "no" }))}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>File name</Label>
                      <Input
                        value={previewForm.fileName}
                        onChange={(event) => setPreviewForm((prev) => ({ ...prev, fileName: event.target.value }))}
                        placeholder="Enter file name"
                        className="h-9"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="space-y-1.5">
                      <Label>Sheet width (mm)</Label>
                      <Input
                        type="number"
                        value={previewForm.sheetWidthMm}
                        onChange={(event) => setPreviewForm((prev) => ({ ...prev, sheetWidthMm: event.target.value }))}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Sheet height (mm)</Label>
                      <Input
                        type="number"
                        value={previewForm.sheetHeightMm}
                        onChange={(event) => setPreviewForm((prev) => ({ ...prev, sheetHeightMm: event.target.value }))}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Page margin top</Label>
                      <Input
                        type="number"
                        value={previewForm.pageMarginTopMm}
                        onChange={(event) => setPreviewForm((prev) => ({ ...prev, pageMarginTopMm: event.target.value }))}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Page margin left</Label>
                      <Input
                        type="number"
                        value={previewForm.pageMarginLeftMm}
                        onChange={(event) => setPreviewForm((prev) => ({ ...prev, pageMarginLeftMm: event.target.value }))}
                        className="h-9"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Row margin (optional)</Label>
                      <Input
                        type="number"
                        value={previewForm.rowMarginMm}
                        onChange={(event) => setPreviewForm((prev) => ({ ...prev, rowMarginMm: event.target.value }))}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Column margin (optional)</Label>
                      <Input
                        type="number"
                        value={previewForm.columnMarginMm}
                        onChange={(event) => setPreviewForm((prev) => ({ ...prev, columnMarginMm: event.target.value }))}
                        className="h-9"
                      />
                    </div>
                  </div>

                  {previewError && (
                    <p className="text-sm text-destructive">{previewError}</p>
                  )}
                  {isGeneratingPreview && previewProgressText && (
                    <p className="text-sm text-muted-foreground">{previewProgressText}</p>
                  )}

                  <div className="flex gap-3 pt-1">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        if (isGeneratingPreview) {
                          abortRef.current?.abort();
                        } else {
                          setPreviewDialogStep(1);
                        }
                      }}
                    >
                      {isGeneratingPreview ? "Stop" : "← Back"}
                    </Button>
                    <Button className="flex-1 gap-1.5" disabled={isGeneratingPreview} onClick={() => void handleGeneratePreviewPdf()}>
                      {isGeneratingPreview
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Download className="h-4 w-4" />}
                      Generate preview
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* ── Generate Bar Code Dialog ── */}
          <Dialog open={isGenerateBarcodeOpen} onOpenChange={setIsGenerateBarcodeOpen}>
            <DialogContent className="sm:max-w-[380px]">
              <DialogHeader>
                <DialogTitle>Generate Bar Code</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-1">
                <p className="text-sm text-muted-foreground">
                  Select which field value to encode as a barcode. Barcodes will be saved to
                  {dataSelectedIds.size > 0 ? ` ${dataSelectedIds.size} selected` : " all"} records.
                </p>
                <div className="space-y-1.5">
                  <Label>Field to encode</Label>
                  <Select value={barcodeField} onValueChange={setBarcodeField}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select a field…" />
                    </SelectTrigger>
                    <SelectContent>
                      {dataFields.map((f) => (
                        <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setIsGenerateBarcodeOpen(false)}>Cancel</Button>
                <Button className="flex-1 gap-1.5" disabled={!barcodeField} onClick={handleGenerateBarcodes}>
                  <QrCode className="h-4 w-4" /> Generate
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* ── Bulk Image Upload Dialog ── */}
          <Dialog open={isBulkImageUploadOpen} onOpenChange={(o) => { setIsBulkImageUploadOpen(o); if (!o) { setBulkImageResults(null); setManualAssign({}); } }}>
            <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Archive className="h-5 w-5" />
                  Bulk Image Upload
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-1">
                {/* Upload buttons */}
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    className="gap-2 h-20 flex-col text-sm"
                    disabled={bulkImageProcessing}
                    onClick={() => bulkImageZipRef.current?.click()}
                  >
                    <Archive className="h-6 w-6 text-muted-foreground" />
                    Upload ZIP File
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2 h-20 flex-col text-sm"
                    disabled={bulkImageProcessing}
                    onClick={() => bulkImageFolderRef.current?.click()}
                  >
                    <FolderOpen className="h-6 w-6 text-muted-foreground" />
                    Upload Folder
                  </Button>
                </div>

                {/* Processing indicator */}
                {bulkImageProcessing && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing images…
                  </div>
                )}

                {/* Results */}
                {bulkImageResults && !bulkImageProcessing && (
                  <div className="space-y-2.5">

                    {/* ── MATCHED ── */}
                    <details className="rounded-lg border border-green-200 bg-green-50 overflow-hidden" open>
                      <summary className="flex items-center gap-1.5 px-3 py-2.5 cursor-pointer select-none text-sm font-medium text-green-800 [list-style:none] [&::-webkit-details-marker]:hidden">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        <span>{bulkImageResults.matched.length} image{bulkImageResults.matched.length !== 1 ? 's' : ''} matched</span>
                        <ChevronDown className="h-3.5 w-3.5 ml-auto opacity-50" />
                      </summary>
                      {bulkImageResults.matched.length > 0 && (
                        <ul className="text-xs text-green-700 space-y-1 max-h-48 overflow-y-auto px-3 pb-2.5 pt-1.5 border-t border-green-200">
                          {bulkImageResults.matched.map((m) => (
                            <li key={m.userId + m.filename} className="flex gap-1.5 items-center rounded px-1 py-0.5">
                              <img src={m.dataUrl} alt="" className="h-5 w-5 rounded-full object-cover shrink-0" />
                              <span className="truncate flex-1">{m.filename} → <strong>{m.name}</strong></span>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 bg-green-200 text-green-800">
                                Matched
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>

                    {/* ── UNMATCHED ── */}
                    {bulkImageResults.unmatched.length > 0 && (
                      <details className="rounded-lg border border-muted bg-muted/30 overflow-hidden">
                        <summary className="flex items-center gap-1.5 px-3 py-2.5 cursor-pointer select-none text-sm font-medium text-muted-foreground [list-style:none] [&::-webkit-details-marker]:hidden">
                          <X className="h-4 w-4 shrink-0" />
                          <span>{bulkImageResults.unmatched.length} file{bulkImageResults.unmatched.length !== 1 ? 's' : ''} unmatched</span>
                          <ChevronDown className="h-3.5 w-3.5 ml-auto opacity-50" />
                        </summary>
                        <ul className="text-xs space-y-2 max-h-52 overflow-y-auto px-3 pb-3 pt-2 border-t border-muted">
                          {bulkImageResults.unmatched.map((u, i) => (
                            <li key={i} className="space-y-1">
                              <p className="font-medium text-foreground/80 truncate">📄 {u.filename}</p>
                              <p className="text-[11px] pl-3 text-muted-foreground mt-0.5">↳ {u.reason}</p>
                              <div className="pl-3">
                                <Select
                                  value={manualAssign[u.filename] ?? ''}
                                  onValueChange={(v) => setManualAssign((prev) => ({ ...prev, [u.filename]: v }))}
                                >
                                  <SelectTrigger className="h-6 text-[11px] w-full border-dashed">
                                    <SelectValue placeholder="Manually assign to student…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {dataRecords.map((rec) => (
                                      <SelectItem key={rec.id} value={rec.id} className="text-xs">
                                        {String(rec['Name'] ?? rec['name'] ?? rec['full_name'] ?? rec['Full Name'] ?? rec.id)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}

                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => { setIsBulkImageUploadOpen(false); setBulkImageResults(null); setManualAssign({}); }}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  disabled={!bulkImageResults || (bulkImageResults.matched.length === 0 && Object.keys(manualAssign).length === 0) || bulkImageProcessing}
                  onClick={handleApplyBulkImages}
                >
                  Apply {bulkImageResults ? `(${bulkImageResults.matched.length + Object.values(manualAssign).filter(Boolean).length})` : ""} Images
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* ── Delete All Data Confirm Dialog ── */}
          <Dialog open={isDeleteAllOpen} onOpenChange={setIsDeleteAllOpen}>
            <DialogContent className="sm:max-w-[380px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  Delete All {dataCategory === "student" ? "Student" : "Staff"} Data
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground py-2">
                This will permanently delete all <strong>{dataRecords.length} {dataCategory}</strong> records
                and their fields for this project. This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setIsDeleteAllOpen(false)}>Cancel</Button>
                <Button variant="destructive" className="flex-1" onClick={handleDeleteAllData}>Delete All</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* ── Add Data Dialog ── */}
          <Dialog open={isAddDataOpen} onOpenChange={setIsAddDataOpen}>
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>Add Record</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 max-h-80 overflow-y-auto py-1">
                {dataFields.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-xs">{f.label}</Label>
                    <Input
                      value={addDataDraft[f.key] ?? ""}
                      onChange={(e) => setAddDataDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setIsAddDataOpen(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleCommitAddData}>Add Record</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* ── Bulk Edit Dialog ── */}
          <Dialog open={isBulkEditOpen} onOpenChange={setIsBulkEditOpen}>
            <DialogContent className="sm:max-w-[400px]">
              <DialogHeader>
                <DialogTitle>
                  Bulk Edit
                  {dataSelectedIds.size > 0 && (
                    <span className="text-sm font-normal text-muted-foreground ml-2 align-middle">
                      ({dataSelectedIds.size} records selected)
                    </span>
                  )}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-1">
                <div className="space-y-1.5">
                  <Label>Field to update</Label>
                  <Select value={bulkEditField} onValueChange={setBulkEditField}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select a field…" />
                    </SelectTrigger>
                    <SelectContent>
                      {dataFields.map((f) => (
                        <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>New value</Label>
                  <Input
                    value={bulkEditValue}
                    onChange={(e) => setBulkEditValue(e.target.value)}
                    placeholder="Enter new value…"
                    className="h-8 text-xs"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {dataSelectedIds.size > 0
                    ? `Will update ${dataSelectedIds.size} selected record(s)`
                    : `Will update all ${dataRecords.length} record(s)`}
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setIsBulkEditOpen(false)}>Cancel</Button>
                <Button className="flex-1" disabled={!bulkEditField} onClick={handleCommitBulkEdit}>Apply</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* ── Edit Fields Dialog ── */}
          <Dialog open={isEditFieldsOpen} onOpenChange={setIsEditFieldsOpen}>
            <DialogContent className="sm:max-w-[480px]">
              <DialogHeader>
                <DialogTitle>Edit Fields</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 max-h-80 overflow-y-auto py-1">
                {editFieldsDraft.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={f.key}
                      onChange={(e) => setEditFieldsDraft((d) => d.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                      placeholder="Key"
                      className="h-8 text-xs font-mono flex-1"
                    />
                    <Input
                      value={f.label}
                      onChange={(e) => setEditFieldsDraft((d) => d.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                      placeholder="Label"
                      className="h-8 text-xs flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => setEditFieldsDraft((d) => d.filter((_, j) => j !== i))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs w-full"
                onClick={() => setEditFieldsDraft((d) => [...d, { key: "", label: "" }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add Field
              </Button>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setIsEditFieldsOpen(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleSaveFields}>Save Fields</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* ── Add Group Dialog ── */}
          <Dialog open={isAddGroupOpen} onOpenChange={(open) => { setIsAddGroupOpen(open); if (!open) { resetAddGroupDialog(); } }}>
            <DialogContent className="sm:max-w-[560px] p-0 overflow-hidden">
              <DialogHeader>
                <div className="border-b bg-muted/30 px-6 py-4">
                  <DialogTitle>Add Group</DialogTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Create a print group and assign a template for grouped records.
                  </p>
                </div>
              </DialogHeader>
              <div className="space-y-5 px-6 py-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Group Name <span className="text-destructive">*</span></Label>
                    <Input
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="e.g. Class A, Good Quality"
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddGroup(); }}
                      className="h-9"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>School</Label>
                    <Input value={project?.client || "-"} readOnly className="h-9 bg-muted/40" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Template</Label>
                  <Select value={newGroupTemplateId || "__none__"} onValueChange={(val) => setNewGroupTemplateId(val === "__none__" ? "" : val)}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={templates.length === 0 ? "No templates available" : "Select a template"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No template</SelectItem>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          <span className="flex items-center gap-2">
                            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                            {t.templateName}
                            <span className="text-muted-foreground text-xs">({t.templateType})</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {templates.length === 0 && (
                    <p className="text-xs text-muted-foreground">Create templates in the Templates tab first.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Filters</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Class</Label>
                      <Select
                        value={newGroupFilters.classValue}
                        onValueChange={(value) => setNewGroupFilters((prev) => ({ ...prev, classValue: value }))}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Class" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={GROUP_FILTER_ALL}>All</SelectItem>
                          {groupFilterOptions.classValue.map((value) => (
                            <SelectItem key={value} value={value}>{value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Gender</Label>
                      <Select
                        value={newGroupFilters.gender}
                        onValueChange={(value) => setNewGroupFilters((prev) => ({ ...prev, gender: value }))}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Gender" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={GROUP_FILTER_ALL}>All</SelectItem>
                          {groupFilterOptions.gender.map((value) => (
                            <SelectItem key={value} value={value}>{value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Transport</Label>
                      <Select
                        value={newGroupFilters.transport}
                        onValueChange={(value) => setNewGroupFilters((prev) => ({ ...prev, transport: value }))}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Transport" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={GROUP_FILTER_ALL}>All</SelectItem>
                          {groupFilterOptions.transport.map((value) => (
                            <SelectItem key={value} value={value}>{value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Boarding</Label>
                      <Select
                        value={newGroupFilters.boarding}
                        onValueChange={(value) => setNewGroupFilters((prev) => ({ ...prev, boarding: value }))}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Boarding" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={GROUP_FILTER_ALL}>All</SelectItem>
                          {groupFilterOptions.boarding.map((value) => (
                            <SelectItem key={value} value={value}>{value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">House</Label>
                      <Select
                        value={newGroupFilters.house}
                        onValueChange={(value) => setNewGroupFilters((prev) => ({ ...prev, house: value }))}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="House" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={GROUP_FILTER_ALL}>All</SelectItem>
                          {groupFilterOptions.house.map((value) => (
                            <SelectItem key={value} value={value}>{value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Selected records can be assigned to this group from the Data tab after creating it.
                </div>
              </div>

              <div className="flex gap-3 px-6 pb-6">
                <Button variant="outline" className="flex-1" onClick={() => setIsAddGroupOpen(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleAddGroup} disabled={!newGroupName.trim()}>Create Group</Button>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}


