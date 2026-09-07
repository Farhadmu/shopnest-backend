import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Product } from "../../products/product.model";
import { ShoppingJourney } from "../customer-intelligence.model";
import { getUserId } from "../../../utils/getUserId";

// SMART SHOPPING JOURNEY
export const getShoppingJourney = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const journey = await ShoppingJourney.findOne({ userId }).sort({ updatedAt: -1 });

  if (!journey) {
    return sendSuccess(res, {
      journey: null,
      recommendedItems: [],
    });
  }

  // Populate product details for recommendations
  const recommendedItems = await Product.find({
    _id: { $in: journey.recommendedProducts || [] },
    isDeleted: false,
  }).limit(4);

  sendSuccess(res, {
    journey: journey.toJSON(),
    recommendedItems,
  });
});

export const recordJourneyEvent = asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { eventType, productId, productTitle, category, price, metadata } = req.body;

  let journey = await ShoppingJourney.findOne({ userId }).sort({ updatedAt: -1 });

  if (!journey) {
    journey = new ShoppingJourney({
      userId,
      category: category || "Electronics",
      currentStage: "discovery",
      journeyProgress: 20,
      events: [],
    });
  }

  journey.events.push({
    eventType,
    productId,
    productTitle,
    category,
    price,
    metadata,
    createdAt: new Date(),
  });

  // Dynamically update progress & stage
  const eventTypes = journey.events.map((e) => e.eventType);
  if (eventTypes.includes("purchase")) {
    journey.currentStage = "completed";
    journey.journeyProgress = 100;
  } else if (eventTypes.includes("cart_add")) {
    journey.currentStage = "ready_to_buy";
    journey.journeyProgress = 80;
  } else if (eventTypes.includes("wishlist_add") || eventTypes.filter((t) => t === "view").length >= 3) {
    journey.currentStage = "intent";
    journey.journeyProgress = 60;
  } else if (eventTypes.filter((t) => t === "view").length >= 1) {
    journey.currentStage = "evaluation";
    journey.journeyProgress = 40;
  }

  await journey.save();
  sendSuccess(res, journey.toJSON(), "Journey event recorded");
});
