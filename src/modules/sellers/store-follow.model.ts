import { Schema, model } from "mongoose";
import { applyToJSON } from "../../utils/model-plugins";

export interface IStoreFollow {
  userId: string;
  storeId: string;
  createdAt: Date;
  updatedAt: Date;
}

const storeFollowSchema = new Schema<IStoreFollow>(
  {
    userId: { type: String, required: true, index: true },
    storeId: { type: String, required: true, index: true },
  },
  { timestamps: true },
);

storeFollowSchema.index({ userId: 1, storeId: 1 }, { unique: true });
applyToJSON(storeFollowSchema);

export const StoreFollow = model<IStoreFollow>("StoreFollow", storeFollowSchema);
