import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";

import piPrettyExtension from "../src/index.js";

class MockText {
	private text = "";
	constructor(_text = "", _x = 0, _y = 0) {}
	setText(value: string) {
		this.text = value;
	}
	getText() {
		return this.text;
	}
}

const mockTheme = {
	fg: (_key: string, text: string) => text,
	bold: (text: string) => text,
};

const ansiMockTheme = {
	fg: (_key: string, text: string) => `\x1b[31m${text}\x1b[0m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
};

function mockToolFactory(exec: any) {
	return (_cwd: string) => ({
		name: "mock",
		description: "mock",
		parameters: { type: "object", properties: {} },
		execute: exec,
	});
}

function withStdoutColumns<T>(columns: number, fn: () => T): T {
	const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
	Object.defineProperty(process.stdout, "columns", { configurable: true, value: columns });
	try {
		return fn();
	} finally {
		if (descriptor) {
			Object.defineProperty(process.stdout, "columns", descriptor);
		} else {
			delete (process.stdout as NodeJS.WriteStream & { columns?: number }).columns;
		}
	}
}

function loadBashTool(exec: any = async () => ({ content: [{ type: "text", text: "" }] })) {
	const noopExec = async () => ({ content: [{ type: "text", text: "" }] });
	const tools = new Map<string, any>();
	const pi = {
		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerCommand: () => {},
		on: () => {},
	};

	piPrettyExtension(pi, {
		sdk: {
			createReadToolDefinition: mockToolFactory(noopExec),
			createBashToolDefinition: mockToolFactory(exec),
			createLsToolDefinition: mockToolFactory(noopExec),
			createFindToolDefinition: mockToolFactory(noopExec),
			createGrepToolDefinition: mockToolFactory(noopExec),
			getAgentDir: () => "/tmp/pi-pretty-test",
		},
		TextComponent: MockText,
	});

	return tools.get("bash");
}

describe("bash renderCall expansion", () => {
	it("truncates long commands when collapsed", () => {
		const bashTool = loadBashTool();
		const command = `printf '${"x".repeat(120)}'`;

		const rendered = bashTool.renderCall({ command }, mockTheme, {
			lastComponent: new MockText(),
			isError: false,
			state: {},
			expanded: false,
			invalidate: () => {},
		});

		expect(rendered.getText()).toContain("bash");
		expect(rendered.getText()).toContain("…");
		expect(rendered.getText()).not.toContain(command);
	});

	it("shows the full command when expanded", () => {
		const bashTool = loadBashTool();
		const command = `printf '${"x".repeat(120)}'`;

		const rendered = bashTool.renderCall({ command }, mockTheme, {
			lastComponent: new MockText(),
			isError: false,
			state: {},
			expanded: true,
			invalidate: () => {},
		});

		expect(rendered.getText()).toContain(command);
	});

	it("preserves timeout text in both collapsed and expanded states", () => {
		const bashTool = loadBashTool();
		const command = `printf '${"x".repeat(120)}'`;

		const collapsed = bashTool.renderCall({ command, timeout: 5 }, mockTheme, {
			lastComponent: new MockText(),
			isError: false,
			state: {},
			expanded: false,
			invalidate: () => {},
		});
		const expanded = bashTool.renderCall({ command, timeout: 5 }, mockTheme, {
			lastComponent: new MockText(),
			isError: false,
			state: {},
			expanded: true,
			invalidate: () => {},
		});

		expect(collapsed.getText()).toContain("5s timeout");
		expect(expanded.getText()).toContain("5s timeout");
	});

	it("truncates expanded ANSI tool headers to the terminal width before padding backgrounds", () => {
		withStdoutColumns(84, () => {
			const bashTool = loadBashTool();
			const command = `printf '${"界".repeat(120)}'`;

			const rendered = bashTool.renderCall({ command }, ansiMockTheme, {
				lastComponent: new MockText(),
				isError: false,
				state: {},
				expanded: true,
				invalidate: () => {},
			});

			for (const line of rendered.getText().split("\n")) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(80);
			}
		});
	});

	it("does not exceed narrow terminal widths", () => {
		withStdoutColumns(24, () => {
			const bashTool = loadBashTool();
			const command = `printf '${"x".repeat(120)}'`;

			const rendered = bashTool.renderCall({ command }, ansiMockTheme, {
				lastComponent: new MockText(),
				isError: false,
				state: {},
				expanded: true,
				invalidate: () => {},
			});

			for (const line of rendered.getText().split("\n")) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(20);
			}
		});
	});
});

describe("bash streaming rendering", () => {
	it("normalizes partial updates with pi-pretty bash details", async () => {
		const command = "printf line-1";
		const partialUpdates: any[] = [];
		const bashTool = loadBashTool(async (_tid: string, _params: any, _sig: AbortSignal | undefined, onUpdate: any) => {
			onUpdate?.({
				content: [{ type: "text", text: "line-1" }],
				details: { fullOutputPath: "/tmp/full-output.txt" },
			});

			return { content: [{ type: "text", text: "done" }] };
		});

		const result = await bashTool.execute(
			"tid",
			{ command },
			undefined,
			(partial: any) => partialUpdates.push(partial),
			{},
		);

		expect(partialUpdates).toHaveLength(1);
		expect(partialUpdates[0].details).toMatchObject({
			_type: "bashResult",
			text: "line-1",
			command,
			exitCode: null,
			running: true,
			fullOutputPath: "/tmp/full-output.txt",
		});
		expect(result.details).toMatchObject({
			_type: "bashResult",
			text: "done",
			command,
			exitCode: 0,
			running: false,
		});
	});

	it("renders partial bash results as running instead of killed", () => {
		const bashTool = loadBashTool();
		const rendered = bashTool.renderResult(
			{
				content: [{ type: "text", text: "line-1" }],
				details: {
					_type: "bashResult",
					text: "line-1",
					exitCode: null,
					command: "echo line-1",
					running: true,
				},
			},
			{ expanded: false, isPartial: true },
			mockTheme,
			{
				lastComponent: new MockText(),
				isError: false,
				state: {},
				expanded: false,
				invalidate: () => {},
			},
		);

		expect(rendered.getText()).toContain("running");
		expect(rendered.getText()).not.toContain("killed");
	});

	it("uses opt.isPartial as the canonical running signal", () => {
		const bashTool = loadBashTool();
		const rendered = bashTool.renderResult(
			{
				content: [{ type: "text", text: "line-1" }],
				details: {
					_type: "bashResult",
					text: "line-1",
					exitCode: null,
					command: "echo line-1",
				},
			},
			{ expanded: false, isPartial: true },
			mockTheme,
			{
				lastComponent: new MockText(),
				isError: false,
				state: {},
				expanded: false,
				invalidate: () => {},
			},
		);

		expect(rendered.getText()).toContain("running");
		expect(rendered.getText()).not.toContain("killed");
	});

	it("renders the latest streamed lines for collapsed partial bash results", () => {
		const bashTool = loadBashTool();
		const output = Array.from({ length: 100 }, (_, i) => `line-${i + 1}`).join("\n");
		const rendered = bashTool.renderResult(
			{
				content: [{ type: "text", text: output }],
				details: {
					_type: "bashResult",
					text: output,
					exitCode: null,
					command: "seq 1 100",
					running: true,
				},
			},
			{ expanded: false, isPartial: true },
			mockTheme,
			{
				lastComponent: new MockText(),
				isError: false,
				state: {},
				expanded: false,
				invalidate: () => {},
			},
		);

		expect(rendered.getText()).toContain("line-100");
		expect(rendered.getText()).toContain("earlier lines");
		expect(rendered.getText()).not.toContain("more lines");
	});

	it("normalizes Pi's initial empty bash partial update", async () => {
		const command = "sleep 1";
		const partialUpdates: any[] = [];
		const bashTool = loadBashTool(async (_tid: string, _params: any, _sig: AbortSignal | undefined, onUpdate: any) => {
			onUpdate?.({ content: [], details: undefined });

			return { content: [{ type: "text", text: "" }] };
		});

		await bashTool.execute("tid", { command }, undefined, (partial: any) => partialUpdates.push(partial), {});

		expect(partialUpdates).toHaveLength(1);
		expect(partialUpdates[0].details).toMatchObject({
			_type: "bashResult",
			text: "",
			command,
			exitCode: null,
			running: true,
		});
	});

	it("renders an empty partial bash result as running", () => {
		const bashTool = loadBashTool();
		const rendered = bashTool.renderResult(
			{
				content: [],
				details: {
					_type: "bashResult",
					text: "",
					exitCode: null,
					command: "sleep 1",
					running: true,
				},
			},
			{ expanded: false, isPartial: true },
			mockTheme,
			{
				lastComponent: new MockText(),
				isError: false,
				state: {},
				expanded: false,
				invalidate: () => {},
			},
		);

		expect(rendered.getText()).toContain("running");
		expect(rendered.getText()).not.toContain("done");
		expect(rendered.getText()).not.toContain("killed");
	});

	it("renders the latest lines for collapsed final bash results", () => {
		const bashTool = loadBashTool();
		const output = Array.from({ length: 100 }, (_, i) => `line-${String(i + 1).padStart(3, "0")}`).join("\n");
		const rendered = bashTool.renderResult(
			{
				content: [{ type: "text", text: output }],
				details: {
					_type: "bashResult",
					text: output,
					exitCode: 0,
					command: "seq 1 100",
					running: false,
				},
			},
			{ expanded: false, isPartial: false },
			mockTheme,
			{
				lastComponent: new MockText(),
				isError: false,
				state: {},
				expanded: false,
				invalidate: () => {},
			},
		);

		expect(rendered.getText()).toContain("line-100");
		expect(rendered.getText()).toContain("earlier lines");
		expect(rendered.getText()).not.toContain("line-001");
		expect(rendered.getText()).not.toContain("more lines");
	});

	it("renders all final bash lines when expanded", () => {
		const bashTool = loadBashTool();
		const output = Array.from({ length: 100 }, (_, i) => `line-${String(i + 1).padStart(3, "0")}`).join("\n");
		const rendered = bashTool.renderResult(
			{
				content: [{ type: "text", text: output }],
				details: {
					_type: "bashResult",
					text: output,
					exitCode: 0,
					command: "seq 1 100",
					running: false,
				},
			},
			{ expanded: true, isPartial: false },
			mockTheme,
			{
				lastComponent: new MockText(),
				isError: false,
				state: {},
				expanded: true,
				invalidate: () => {},
			},
		);

		expect(rendered.getText()).toContain("line-001");
		expect(rendered.getText()).toContain("line-100");
		expect(rendered.getText()).not.toContain("earlier lines");
		expect(rendered.getText()).not.toContain("more lines");
	});

	it("renders truncation and full output notices for partial bash results", () => {
		const bashTool = loadBashTool();
		const output = Array.from({ length: 5 }, (_, i) => `line-${96 + i}`).join("\n");
		const rendered = bashTool.renderResult(
			{
				content: [{ type: "text", text: output }],
				details: {
					_type: "bashResult",
					text: output,
					exitCode: null,
					command: "seq 1 100",
					running: true,
					fullOutputPath: "/tmp/full-output.txt",
					truncation: {
						truncated: true,
						truncatedBy: "lines",
						outputLines: 5,
						totalLines: 100,
					},
				},
			},
			{ expanded: false, isPartial: true },
			mockTheme,
			{
				lastComponent: new MockText(),
				isError: false,
				state: {},
				expanded: false,
				invalidate: () => {},
			},
		);

		expect(rendered.getText()).toContain("Full output: /tmp/full-output.txt");
		expect(rendered.getText()).toContain("Truncated: showing 5 of 100 lines");
	});

	it("renders full output path when provided without truncation", () => {
		const bashTool = loadBashTool();
		const rendered = bashTool.renderResult(
			{
				content: [{ type: "text", text: "line-1" }],
				details: {
					_type: "bashResult",
					text: "line-1",
					exitCode: 0,
					command: "printf line-1",
					running: false,
					fullOutputPath: "/tmp/full-output.txt",
				},
			},
			{ expanded: false, isPartial: false },
			mockTheme,
			{
				lastComponent: new MockText(),
				isError: false,
				state: {},
				expanded: false,
				invalidate: () => {},
			},
		);

		expect(rendered.getText()).toContain("Full output: /tmp/full-output.txt");
		expect(rendered.getText()).not.toContain("Truncated:");
	});

	it("does not duplicate core final bash truncation notices", () => {
		const bashTool = loadBashTool();
		const fullOutputPath = "/tmp/full-output.txt";
		const output = `line-099\nline-100\n\n[Showing lines 99-100 of 100. Full output: ${fullOutputPath}]`;
		const rendered = bashTool.renderResult(
			{
				content: [{ type: "text", text: output }],
				details: {
					_type: "bashResult",
					text: output,
					exitCode: 0,
					command: "seq 1 100",
					running: false,
					fullOutputPath,
					truncation: {
						truncated: true,
						truncatedBy: "lines",
						outputLines: 2,
						totalLines: 100,
					},
				},
			},
			{ expanded: false, isPartial: false },
			mockTheme,
			{
				lastComponent: new MockText(),
				isError: false,
				state: {},
				expanded: false,
				invalidate: () => {},
			},
		);

		const occurrences = rendered.getText().split(`Full output: ${fullOutputPath}`).length - 1;
		expect(occurrences).toBe(1);
		expect(rendered.getText()).not.toContain("[Showing lines");
		expect(rendered.getText()).toContain("Truncated: showing 2 of 100 lines");
	});
});
