import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Product } from "../../products/product.model";
import { ProductQuestion } from "../customer-extras.model";

export const getProductQuestions = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const questions = await ProductQuestion.find({ productId }).sort({ createdAt: -1 });
  sendSuccess(res, questions);
});

export const askProductQuestion = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const userName = req.user!.name || "Customer";
  const { productId, question } = req.body;

  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const newQ = await ProductQuestion.create({
    productId,
    userId,
    userName,
    question,
    answers: [],
    isAnswered: false,
  });

  sendSuccess(res, newQ, "Your question was posted successfully! Sellers and verified buyers will answer shortly.");
});

export const answerProductQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { questionId } = req.params;
  const { content, authorRole = "customer" } = req.body;
  const authorId = req.user!.id;
  const authorName = req.user!.name || "Community Member";

  const question = await ProductQuestion.findById(questionId);
  if (!question) throw ApiError.notFound("Question not found");

  question.answers.push({
    authorId,
    authorName,
    authorRole,
    content,
    helpfulVotes: 0,
    createdAt: new Date(),
  });
  question.isAnswered = true;
  await question.save();

  sendSuccess(res, question, "Answer submitted successfully!");
});

// ============================================================
// 10. PERSONALIZED DEAL FEED (Feature 22)
// ============================================================
