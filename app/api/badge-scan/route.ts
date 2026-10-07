import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/client";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { session_id, artwork_id } = body;

    // Make sure the badge sent both values
    if (!session_id || !artwork_id) {
      return NextResponse.json(
        {
          error: "session_id and artwork_id are required",
        },
        {
          status: 400,
        }
      );
    }

    const supabase = createClient();

    const { data, error } = await supabase
      .from("scans")
      .insert({
        session_id,
        artwork_id,
      })
      .select()
      .single();

    if (error) {
      console.error("Badge scan insert error:", error);

      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: 500,
        }
      );
    }

    console.log("Badge scan recorded:", data);

    return NextResponse.json({
      success: true,
      scan: data,
    });
  } catch (error) {
    console.error("Badge API error:", error);

    return NextResponse.json(
      {
        error: "Invalid request",
      },
      {
        status: 400,
      }
    );
  }
}