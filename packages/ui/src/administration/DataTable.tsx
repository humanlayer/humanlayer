import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@humanlayer/ui/components/table'
import {
	type ColumnDef,
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type OnChangeFn,
	type SortingState,
	useReactTable,
} from '@tanstack/react-table'

const DEFAULT_SORTING: SortingState = []
const DEFAULT_COLUMN_FILTERS: ColumnFiltersState = []

interface DataTableProps<TData, TValue> {
	columns: ColumnDef<TData, TValue>[]
	data: TData[]
	sorting?: SortingState
	onSortingChange?: OnChangeFn<SortingState>
	columnFilters?: ColumnFiltersState
	onColumnFiltersChange?: OnChangeFn<ColumnFiltersState>
	globalFilter?: string
	onGlobalFilterChange?: OnChangeFn<string>
	isLoading?: boolean
}

export function DataTable<TData, TValue>({
	columns,
	data,
	sorting = DEFAULT_SORTING,
	onSortingChange,
	columnFilters = DEFAULT_COLUMN_FILTERS,
	onColumnFiltersChange,
	globalFilter = '',
	onGlobalFilterChange,
	isLoading = false,
}: DataTableProps<TData, TValue>) {
	const table = useReactTable({
		data,
		columns,
		state: {
			sorting,
			columnFilters,
			globalFilter,
		},
		onSortingChange,
		onColumnFiltersChange,
		onGlobalFilterChange,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
	})

	return (
		<div className="rounded-md border overflow-x-auto">
			<Table className="min-w-[400px]">
				<TableHeader>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow key={headerGroup.id}>
							{headerGroup.headers.map((header) => (
								<TableHead key={header.id}>
									{header.isPlaceholder
										? null
										: flexRender(header.column.columnDef.header, header.getContext())}
								</TableHead>
							))}
						</TableRow>
					))}
				</TableHeader>
				<TableBody>
					{isLoading ? (
						<TableRow>
							<TableCell colSpan={columns.length} className="h-24 text-center">
								Loading...
							</TableCell>
						</TableRow>
					) : table.getRowModel().rows?.length ? (
						table.getRowModel().rows.map((row) => (
							<TableRow key={row.id}>
								{row.getVisibleCells().map((cell) => (
									<TableCell key={cell.id}>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						))
					) : (
						<TableRow>
							<TableCell colSpan={columns.length} className="h-24 text-center">
								No data found.
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
		</div>
	)
}
