import { useQuery } from "@tanstack/react-query";
import { doctorApi } from "../api/doctor";

export function useDoctor() {
  return useQuery({ queryKey: ["doctor"], queryFn: doctorApi.run });
}
