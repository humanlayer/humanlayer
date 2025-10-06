package filescan

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func BenchmarkScanner_10KFiles(b *testing.B) {
	tmpDir := b.TempDir()
	createBenchFiles(b, tmpDir, 10000)

	opts := ScanOptions{
		Paths:            []string{tmpDir},
		RespectGitignore: false,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		scanner, _ := NewScanner(opts)
		_, _ = scanner.Scan(context.Background())
	}
}

func BenchmarkScanner_WithGitignore(b *testing.B) {
	tmpDir := b.TempDir()

	// Create .gitignore
	gitignore := filepath.Join(tmpDir, ".gitignore")
	_ = os.WriteFile(gitignore, []byte("*.log\nnode_modules/\n"), 0644)

	createBenchFiles(b, tmpDir, 5000)

	opts := ScanOptions{
		Paths:            []string{tmpDir},
		RespectGitignore: true,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		scanner, _ := NewScanner(opts)
		_, _ = scanner.Scan(context.Background())
	}
}

func createBenchFiles(b *testing.B, root string, count int) {
	for i := 0; i < count; i++ {
		dir := filepath.Join(root, fmt.Sprintf("dir%d", i/100))
		_ = os.MkdirAll(dir, 0755)

		filename := filepath.Join(dir, fmt.Sprintf("file%d.txt", i))
		_ = os.WriteFile(filename, []byte("content"), 0644)
	}
}
