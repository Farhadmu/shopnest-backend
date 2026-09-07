import { Request, Response } from "express";
import { Courier } from "./courier.model";
import { DeliveryZone } from "./delivery-zone.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

export const listCouriers = asyncHandler(async (req: Request, res: Response) => {
  const couriers = await Courier.find().sort({ name: 1 });
  sendSuccess(res, couriers);
});

export const createCourier = asyncHandler(async (req: Request, res: Response) => {
  const courier = await Courier.create(req.body);
  sendSuccess(res, courier.toJSON(), "Courier created", 201);
});

export const updateCourier = asyncHandler(async (req: Request, res: Response) => {
  const courier = await Courier.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!courier) throw ApiError.notFound("Courier not found");
  sendSuccess(res, courier.toJSON(), "Courier updated");
});

export const compareCouriers = asyncHandler(async (req: Request, res: Response) => {
  const { destinationDistrict, destinationDivision, weight } = req.query as {
    destinationDistrict: string;
    destinationDivision: string;
    weight?: string;
  };

  const couriers = await Courier.find({ isActive: true });
  const zone = await DeliveryZone.findOne({
    isActive: true,
    districts: { $in: [destinationDistrict] },
    divisions: { $in: [destinationDivision] },
  });

  const zoneType = zone?.type || "custom";
  const weightKg = weight ? parseFloat(weight) : 0.5;

  const comparisons = couriers.map((c) => {
    const coverage = c.coverageAreas.find((cov) => cov.zoneType === zoneType);
    const rateItem = coverage?.rateStructure.find((r) => {
      const match = r.weightRange.match(/(\d+(?:\.\d+)?)\s*kg/i);
      if (!match) return false;
      return weightKg <= parseFloat(match[1]);
    });
    const fallbackRate = c.rateStructure.find((r) => {
      const match = r.weightRange.match(/(\d+(?:\.\d+)?)\s*kg/i);
      if (!match) return false;
      return weightKg <= parseFloat(match[1]);
    });
    const price = rateItem?.price ?? fallbackRate?.price ?? c.rateStructure[c.rateStructure.length - 1]?.price ?? 0;

    return {
      courierId: c.id,
      name: c.name,
      logo: c.logo,
      estimatedDays: coverage?.estimatedDays ?? c.estimatedDays,
      price,
      trackingUrl: c.trackingUrl,
    };
  });

  comparisons.sort((a, b) => a.price - b.price);
  sendSuccess(res, { destinationDistrict, destinationDivision, weightKg, comparisons });
});
