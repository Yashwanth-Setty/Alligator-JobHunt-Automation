import SearchAutocomplete from './SearchAutocomplete';
import { filterKeywordSuggestions } from '@/lib/jobSearchConstants';

export default function KeywordAutocomplete(props) {
  return (
    <SearchAutocomplete
      {...props}
      placeholder={props.placeholder || 'e.g. backend engineer'}
      getSuggestions={filterKeywordSuggestions}
      minChars={1}
    />
  );
}
