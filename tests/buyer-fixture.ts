import type { BuyerInputs } from '../src/buyer';
import type { NetInputs } from '../src/netsheet';

/** Hand-built inputs shared by the buyer tests: $400,000 / $390,000 / $380,000, closing Jul 11 2027. */
export function buyerCase(): { net: NetInputs; buyer: BuyerInputs } {
  return {
    net: {
      scenarios: [
        { name: 'List', price: 400000 },
        { name: 'Likely', price: 390000 },
        { name: 'Low', price: 380000 },
      ],
      closingDate: '2027-07-11',
      closingDayOwner: 'buyer',
      prorationMethod: 'actual',
      payoffs: [{ id: 'p', label: 'Mortgage', amount: 250000 }],
      lines: [{ id: 'c', group: 'concession', label: 'Concession', mode: 'flat', value: 5000, placeholder: false }],
      prorations: [
        { id: 'x', enabled: true, label: 'Tax', amount: 3650, periodStart: '2027-01-01', periodEnd: '2027-12-31', status: 'unpaid' },
        { id: 'y', enabled: true, label: 'HOA', amount: 200, periodStart: '2027-07-01', periodEnd: '2027-07-31', status: 'paid' },
      ],
    },
    buyer: {
      lines: [
        { id: 'b1', group: 'down', label: 'Down', mode: 'percent', value: 10, placeholder: false },
        { id: 'b2', group: 'loan', label: 'Origination', mode: 'percent', value: 0.5, placeholder: false },
        { id: 'b3', group: 'loan', label: 'Appraisal', mode: 'flat', value: 600, placeholder: false },
        { id: 'b4', group: 'prepaid', label: 'Prepaids', mode: 'flat', value: 1200, placeholder: false },
        { id: 'b5', group: 'escrow', label: 'Reserves', mode: 'flat', value: 2400, placeholder: false },
        { id: 'b6', group: 'settlement', label: 'Title', mode: 'flat', value: 1100, placeholder: false },
        { id: 'b7', group: 'credit', label: 'Earnest money', mode: 'flat', value: 5000, placeholder: false },
      ],
    },
  };
}
