"use client";

export default function GlobalError({
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<html lang="en">
			<body>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						minHeight: "100vh",
						gap: "1rem",
						fontFamily: "system-ui, sans-serif",
					}}
				>
					<h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>
						Something went wrong
					</h1>
					<p style={{ color: "#666" }}>
						An unexpected error occurred. Please try again.
					</p>
					<button
						type="button"
						onClick={() => reset()}
						style={{
							padding: "0.5rem 1rem",
							borderRadius: "0.375rem",
							border: "1px solid #ddd",
							cursor: "pointer",
							background: "#fff",
						}}
					>
						Try again
					</button>
				</div>
			</body>
		</html>
	);
}
