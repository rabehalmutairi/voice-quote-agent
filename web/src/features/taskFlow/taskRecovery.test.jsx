import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useTaskFlow } from "./useTaskFlow";
import { TaskConnectionNotice } from "./TaskConnectionNotice";

function failedRecoveryTransport() {
  return { mode: "api", createTask: vi.fn(async () => ({ taskId: "tsk_A", phase: "idle", requestText: "طلب أ", shops: [] })),
    startTask: vi.fn(), submitAnswers: vi.fn(), subscribe: vi.fn(() => () => {}),
    getTask: vi.fn(async () => { throw Object.assign(new Error("offline"), { userMessage: "تعذر استعادة الطلب" }); }) };
}
describe("task recovery identity", () => {
  it("clears A if restoring B fails, while keeping A on same-task network failure", async () => {
    const transport = failedRecoveryTransport();
    const { result } = renderHook(() => useTaskFlow(transport, { manualStart: true }));
    await act(() => result.current.beginTask("طلب أ"));
    await act(() => result.current.resumeTask("tsk_A"));
    expect(result.current.taskState.taskId).toBe("tsk_A");
    await act(() => result.current.resumeTask("tsk_B"));
    expect(result.current.taskState.taskId).toBeNull();
    expect(result.current.taskState.requestText).toBeNull();
    expect(transport.startTask).not.toHaveBeenCalled();
  });
  it("reconnects to the ID in the URL instead of an earlier active task", async () => {
    const resumeTask = vi.fn();
    render(<TaskConnectionNotice flow={{ transportMode: "api", connection: { state: "disconnected" }, taskState: { taskId: "tsk_A" }, requestedTaskId: "tsk_B", resumeTask }} />);
    await userEvent.click(screen.getByRole("button", { name: "إعادة الاتصال" }));
    expect(resumeTask).toHaveBeenCalledWith("tsk_B");
  });
});
