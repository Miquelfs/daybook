import { NextRequest } from "next/server";
import { forward } from "@/lib/passthrough";

export const POST = (req: NextRequest) => forward(req, "/money/transactions");
