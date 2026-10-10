import { rewriteGrokBashInput } from "../src/bash-call.ts";

function same(actual, expected) {
	const left = JSON.stringify(actual);
	const right = JSON.stringify(expected);
	if (left !== right) {
		console.error("FAIL", left, "expected", right);
		process.exit(1);
	}
}

const command = "git status --short";

same(rewriteGrokBashInput({ command, name: "status", timeout: 3600 }), {
	command,
	timeout: 3600,
});

same(rewriteGrokBashInput({ command, name: "dev", ready: { port: 0 }, timeout: 30, async: true }), {
	command,
	timeout: 30,
});

same(rewriteGrokBashInput({ command, ready: { port: "git" } }), { command });

same(rewriteGrokBashInput({ command, async: true, timeout: 30 }), { command, timeout: 30 });

same(rewriteGrokBashInput({ command, timeout: 30 }), undefined);

console.log("PASS");
