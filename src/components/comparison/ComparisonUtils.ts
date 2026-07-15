import type { ComparisonColumn, ComparisonOption } from './ComparisonTypes';

/**
 * Evaluates the value of a formula column for a specific row.
 */
export function evaluateFormula(column: ComparisonColumn, row: Record<string, any>): number {
  if (column.type !== 'formula' || !column.formulaConfig) return 0;
  
  const { operator, colA, colB } = column.formulaConfig;
  
  const valA = parseFloat(row[colA]) || 0;
  const valB = parseFloat(row[colB]) || 0;
  
  if (operator === 'multiply') {
    return valA * valB;
  }
  
  return 0;
}

/**
 * Calculates the sum of a specific column's values across all rows.
 * Takes formula columns into consideration by evaluating them dynamically.
 */
export function calculateOptionTotal(option: Omit<ComparisonOption, 'totalValue'>): number {
  const sumCol = option.columns.find(c => c.id === option.sumColumnId);
  if (!sumCol) return 0;
  
  return option.rows.reduce((sum, row) => {
    let val = 0;
    if (sumCol.type === 'formula') {
      val = evaluateFormula(sumCol, row);
    } else {
      val = parseFloat(row[option.sumColumnId]) || 0;
    }
    return sum + val;
  }, 0);
}

/**
 * Reorders a column array, moving the column at sourceIndex to targetIndex.
 */
export function reorderColumns(columns: ComparisonColumn[], sourceIndex: number, targetIndex: number): ComparisonColumn[] {
  const result = [...columns];
  const [removed] = result.splice(sourceIndex, 1);
  result.splice(targetIndex, 0, removed);
  return result;
}

/**
 * Creates a complete copy of an option with a new unique ID and a "Copy" suffix on the name.
 */
export function duplicateOption(option: ComparisonOption): ComparisonOption {
  const newId = 'opt_' + Math.random().toString(36).substring(2, 9);
  return {
    ...option,
    id: newId,
    name: `${option.name} (Copy)`,
    rows: option.rows.map(row => ({ ...row }))
  };
}
