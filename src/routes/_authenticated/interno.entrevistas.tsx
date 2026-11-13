import { createFileRoute } from "@tanstack/react-router";
import { InterviewPanel } from "@/components/interno/InterviewPanel";
import { PageTitle } from "@/components/interno/ui";

export const Route = createFileRoute("/_authenticated/interno/entrevistas")({
  head: () => ({ meta: [{ title: "Entrevistas — MAG" }] }),
  component: () => (
    <>
      <PageTitle title="Entrevistas" />
      <InterviewPanel />
    </>
  ),
});
