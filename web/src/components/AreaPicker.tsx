import { useState } from "react";
import { selectClass } from "@/lib/fieldStyles";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TAIWAN_DISTRICTS } from "@/constants/taiwanDistricts";
import { areaLabel, areaName, setSelectedArea, useSelectedArea } from "@/lib/location";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

const SELECT_CLASS = selectClass("md", "w-full px-3");

/** Top-bar "Choose area" button + menu: city/county → district (optional); once chosen, pages show only vendors in that area */
export default function AreaPicker({ className }: { className?: string }) {
  const area = useSelectedArea();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [county, setCounty] = useState("");
  const [town, setTown] = useState("");
  const towns = TAIWAN_DISTRICTS.find((d) => d.county === county)?.towns ?? [];

  function openDialog() {
    setCounty(area?.county ?? "");
    setTown(area?.town ?? "");
    setOpen(true);
  }

  function apply() {
    setSelectedArea(county ? { county, town: town || undefined } : null);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={cn(
          "flex items-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          area ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground",
          className
        )}
        aria-label={area ? t(`目前地區：${areaLabel(area)}，點擊變更`, `Area: ${areaLabel(area)}, click to change`) : t("選擇地區", "Choose area")}
      >
        <MapPin className="w-4 h-4 shrink-0" />
        <span className="truncate max-w-[140px]">{area ? areaLabel(area) : t("選擇地區", "Choose area")}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("選擇地區", "Choose area")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">{t("只顯示地址在這個地區的合作店家。", "Only show partner vendors located in this area.")}</p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="area-county">{t("縣市", "City / County")}</Label>
              <select
                id="area-county"
                className={SELECT_CLASS}
                value={county}
                onChange={(e) => {
                  setCounty(e.target.value);
                  setTown("");
                }}
              >
                <option value="">{t("全部縣市", "All cities / counties")}</option>
                {TAIWAN_DISTRICTS.map((d) => (
                  <option key={d.county} value={d.county}>{areaName(d.county)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="area-town">{t("鄉鎮市區", "District / Township")}</Label>
              <select
                id="area-town"
                className={SELECT_CLASS}
                value={town}
                disabled={!county}
                onChange={(e) => setTown(e.target.value)}
              >
                <option value="">{county ? t("全部鄉鎮市區", "All districts") : t("請先選縣市", "Choose a city / county first")}</option>
                {towns.map((name) => (
                  <option key={name} value={name}>{areaName(county, name)}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            {area && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedArea(null);
                  setOpen(false);
                }}
              >
                {t("清除地區", "Clear area")}
              </Button>
            )}
            <Button onClick={apply}>{t("套用", "Apply")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
