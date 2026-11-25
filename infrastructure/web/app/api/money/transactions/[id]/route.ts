import { NextRequest } from "next/server";
import { forward } from "@/lib/passthrough";

type Ctx = { params: Promise<{ id: string }> };
const to = async ({ params }: Ctx) => `/money/transactions/${encodeURIComponent((await params).id)}`;

export const PATCH = async (req: NextRequest, ctx: Ctx) => forward(req, await to(ctx));
export const DELETE = async (req: NextRequest, ctx: Ctx) => forward(req, await to(ctx));
