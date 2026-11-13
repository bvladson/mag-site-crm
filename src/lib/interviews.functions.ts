import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { interviewInput } from "./interviews";
import { APPLICATION_STAGES } from "./recruitment";

export const getInterviewOptions = createServerFn({ method: "GET" }).handler(async () => {
  const { authorize } = await import("./local-auth.server");
  const { interviewOptionsCore } = await import("./interviews.server");
  return interviewOptionsCore(authorize(["admin", "dho"]));
});
export const listInterviews = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ applicationId: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { authorize } = await import("./local-auth.server");
    const { listInterviewsCore } = await import("./interviews.server");
    return listInterviewsCore(authorize(["admin", "dho"]), data.applicationId);
  });
export const saveInterview = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => interviewInput.parse(d))
  .handler(async ({ data }) => {
    const { authorize } = await import("./local-auth.server");
    const { saveInterviewCore } = await import("./interviews.server");
    return saveInterviewCore(authorize(["admin", "dho"]), data);
  });

export const moveApplicationStage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        from: z.enum(APPLICATION_STAGES),
        to: z.enum(APPLICATION_STAGES),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { authorize } = await import("./local-auth.server");
    const { moveApplicationCore } = await import("./interviews.server");
    return moveApplicationCore(authorize(["admin", "dho"]), data.id, data.from, data.to);
  });
