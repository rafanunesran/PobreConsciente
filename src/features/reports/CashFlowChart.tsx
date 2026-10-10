import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { formatBRL } from '../../lib/utils'
import type { MonthFlow } from './monthlyFlow'

interface CashFlowChartProps {
  flow: MonthFlow[]
}

const W = 320
const H = 150
const PAD_T = 8
const PAD_B = 20
const BAR_GAP = 2

function monthLabel(month: string): string {
  return format(new Date(`${month}-01T00:00:00`), 'MMM', { locale: ptBR }).replace('.', '')
}

// Barras agrupadas (receita | despesa) por mês, SVG inline sem lib — mesmo
// esquema de viewBox fixo + width 100% do BalanceChart. Valor exato fica no
// <title> de cada barra (tooltip nativo) pra não poluir o gráfico.
export function CashFlowChart({ flow }: CashFlowChartProps) {
  const max = Math.max(1, ...flow.flatMap((f) => [f.income, f.expense]))
  const slot = W / flow.length
  const barWidth = Math.max(3, Math.min(18, (slot - 8) / 2 - BAR_GAP / 2))
  const plotHeight = H - PAD_T - PAD_B
  const height = (value: number) => (value / max) * plotHeight

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Receitas e despesas por mês">
        <line
          x1={0}
          x2={W}
          y1={H - PAD_B}
          y2={H - PAD_B}
          className="stroke-border-light dark:stroke-border-dark"
          strokeWidth={1}
        />
        {flow.map((f, i) => {
          const center = slot * i + slot / 2
          const incomeH = height(f.income)
          const expenseH = height(f.expense)
          return (
            <g key={f.month}>
              <rect
                x={center - barWidth - BAR_GAP / 2}
                y={H - PAD_B - incomeH}
                width={barWidth}
                height={incomeH}
                rx={2}
                className="fill-brand-500"
              >
                <title>{`Receitas ${monthLabel(f.month)}: ${formatBRL(f.income)}`}</title>
              </rect>
              <rect
                x={center + BAR_GAP / 2}
                y={H - PAD_B - expenseH}
                width={barWidth}
                height={expenseH}
                rx={2}
                className="fill-danger"
              >
                <title>{`Despesas ${monthLabel(f.month)}: ${formatBRL(f.expense)}`}</title>
              </rect>
              <text
                x={center}
                y={H - 6}
                textAnchor="middle"
                className="fill-light-secondary text-[9px] dark:fill-dark-secondary"
              >
                {monthLabel(f.month)}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="flex justify-center gap-4 text-xs text-light-secondary dark:text-dark-secondary">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />
          Receitas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger" />
          Despesas
        </span>
      </div>
    </div>
  )
}
