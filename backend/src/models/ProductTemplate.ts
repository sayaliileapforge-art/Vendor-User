import mongoose, { Schema, Document } from 'mongoose';

export type TemplateCategory = 'Business' | 'Wedding' | 'Minimal' | 'Corporate' | 'Festival' | 'Other';

export interface IProductTemplate extends Document {
  productId?: mongoose.Types.ObjectId;
  projectId?: string;
  createdBy?: mongoose.Types.ObjectId;
  isGlobal?: boolean;
  templateName: string;
  description?: string;
  category: TemplateCategory;
  previewImageUrl?: string;
  preview_image?: string;
  designFileUrl?: string;
  designData: Record<string, any>;
  isActive: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const ProductTemplateSchema = new Schema<IProductTemplate>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', index: true },
    projectId: { type: String, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'AuthUser', index: true },
    isGlobal: { type: Boolean, default: false, index: true },
    templateName: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    category: {
      type: String,
      enum: ['Business', 'Wedding', 'Minimal', 'Corporate', 'Festival', 'Other'],
      default: 'Other',
      index: true,
    },
    previewImageUrl: { type: String },
    preview_image: { type: String, index: true },
    designFileUrl: String,
    designData: { type: Schema.Types.Mixed, default: {} },
    isActive: { type: Boolean, default: true, index: true },
    tags: { type: [String], default: [] },
  },
  { timestamps: true }
);

ProductTemplateSchema.pre('validate', function ensurePreviewFields(next) {
  const normalizedPreview = this.preview_image || this.previewImageUrl;

  if (normalizedPreview) {
    this.preview_image = normalizedPreview;
    this.previewImageUrl = normalizedPreview;
  }

  next();
});

ProductTemplateSchema.set('toJSON', {
  transform: (_doc, ret: any) => {
    const normalizedPreview = ret.preview_image || ret.previewImageUrl;
    if (normalizedPreview) {
      ret.preview_image = normalizedPreview;
      ret.previewImageUrl = normalizedPreview;
    }
    return ret;
  },
});

ProductTemplateSchema.index(
  { productId: 1, templateName: 1 },
  { unique: true, partialFilterExpression: { productId: { $type: 'objectId' } } }
);

// Compound indexes for fast gallery and project-specific queries
ProductTemplateSchema.index({ isGlobal: 1, updatedAt: -1 });
ProductTemplateSchema.index({ projectId: 1, isGlobal: 1, updatedAt: -1 });
ProductTemplateSchema.index({ projectId: 1, updatedAt: -1 });

export default mongoose.model<IProductTemplate>('ProductTemplate', ProductTemplateSchema);
