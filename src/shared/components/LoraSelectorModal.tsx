import React, { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/shared/components/ui/dialog";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter as ItemCardFooter, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { usePaneAwareModalStyle } from '@/shared/hooks/usePaneAwareModalStyle';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { useListResources, useCreateResource, useDeleteResource, Resource } from '@/shared/hooks/useResources';
import { Textarea } from '@/shared/components/ui/textarea';
import { Label } from '@/shared/components/ui/label';
import { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/shared/components/ui/pagination";

interface LoraModelImage {
  alt_text: string;
  url: string;
  type?: string;
  source?: string;
}

interface LoraModelFile {
  path: string;
  url: string;
  size?: number;
  last_modified?: string;
}

export interface LoraModel {
  "Model ID": string;
  Name: string;
  Author: string;
  Images: LoraModelImage[];
  "Model Files": LoraModelFile[];
  Description?: string;
  Tags?: string[];
  "Last Modified"?: string;
  Downloads?: number;
  Likes?: number;
  lora_type?: string;
  [key: string]: unknown;
}

type SortOption = 'default' | 'downloads' | 'likes' | 'lastModified' | 'name';

interface LoraSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  loras: LoraModel[];
  onAddLora: (lora: LoraModel) => void;
  selectedLoraIds: string[];
  lora_type: string;
}

interface CommunityLorasTabProps {
  loras: LoraModel[];
  onAddLora: (lora: LoraModel) => void;
  selectedLoraIds: string[];
  lora_type: string;
  myLorasResource: UseQueryResult<Resource[], Error>;
  createResource: UseMutationResult<Resource, Error, { type: 'lora'; metadata: LoraModel; }, unknown>;
}

const CommunityLorasTab: React.FC<CommunityLorasTabProps> = ({ loras, onAddLora, selectedLoraIds, lora_type, myLorasResource, createResource }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>('downloads');
  const [page, setPage] = useState(0);
  const ITEMS_PER_PAGE = 20;

  const myLoraModelIds = useMemo(() => myLorasResource.data?.map(r => r.metadata["Model ID"]) || [], [myLorasResource.data]);

  const processedLoras = useMemo(() => {
    let filtered = loras.filter(l => l.lora_type === lora_type);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(lora => {
        for (const key in lora) {
          if (Object.prototype.hasOwnProperty.call(lora, key)) {
            const value = lora[key];
            if (typeof value === 'string' && value.toLowerCase().includes(term)) {
              return true;
            }
            if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
              if (value.some(item => (item as string).toLowerCase().includes(term))) {
                return true;
              }
            }
          }
        }
        return false;
      });
    }

    const sorted = [...filtered];
    switch (sortOption) {
      case 'downloads':
        sorted.sort((a, b) => (b.Downloads || 0) - (a.Downloads || 0));
        break;
      case 'likes':
        sorted.sort((a, b) => (b.Likes || 0) - (a.Likes || 0));
        break;
      case 'lastModified':
        sorted.sort((a, b) => {
          const dateA = a["Last Modified"] ? new Date(a["Last Modified"]).getTime() : 0;
          const dateB = b["Last Modified"] ? new Date(b["Last Modified"]).getTime() : 0;
          return dateB - dateA;
        });
        break;
      case 'name':
        sorted.sort((a, b) => a.Name.localeCompare(b.Name));
        break;
      case 'default':
      default:
        // No specific sort for default, keeps original (potentially pre-filtered) order
        break;
    }
    return sorted;
  }, [loras, searchTerm, sortOption, lora_type]);

  // Reset page when filter/sort changes
  React.useEffect(() => { setPage(0); }, [searchTerm, sortOption, lora_type]);

  const totalPages = Math.ceil(processedLoras.length / ITEMS_PER_PAGE);
  const paginatedLoras = useMemo(() => processedLoras.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE), [processedLoras, page]);

  return (
    <div>
      <div className="flex gap-2 mb-4 pt-2">
        <Input
          type="text"
          placeholder="Search all LoRA fields..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-grow"
        />
        <Select value={sortOption} onValueChange={(value) => setSortOption(value as SortOption)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default Order</SelectItem>
            <SelectItem value="downloads">Downloads</SelectItem>
            <SelectItem value="likes">Likes</SelectItem>
            <SelectItem value="lastModified">Last Modified</SelectItem>
            <SelectItem value="name">Name (A-Z)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ScrollArea className="flex-grow pr-4 h-[500px]">
        <div className="space-y-3 p-1">
          {paginatedLoras.length > 0 ? (
            paginatedLoras.map((lora) => {
              const isSelectedOnGenerator = selectedLoraIds.includes(lora["Model ID"]);
              const isinMyLoras = myLoraModelIds.includes(lora["Model ID"]);

              return (
                <Card key={lora["Model ID"]} className="w-full">
                  <div className="flex flex-col">
                    <CardHeader className="pb-2">
                        <div className="flex justify-between items-start gap-2">
                            <div className="flex-grow">
                                <CardTitle className="text-lg" title={lora.Name !== "N/A" ? lora.Name : lora["Model ID"]}>
                                    {lora.Name !== "N/A" ? lora.Name : lora["Model ID"]}
                                </CardTitle>
                                <p className="text-sm text-muted-foreground" title={lora.Author}>By: {lora.Author}</p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => createResource.mutate({ type: 'lora', metadata: lora })}
                                disabled={isinMyLoras || createResource.isPending}
                                className="flex-shrink-0"
                            >
                                {isinMyLoras ? 'In My LoRAs' : 'Add to My LoRAs'}
                            </Button>
                        </div>
                        <div className="text-xs text-muted-foreground pt-1">
                          {lora.Downloads && <span>Downloads: {lora.Downloads.toLocaleString()} | </span>}
                          {lora.Likes && <span>Likes: {lora.Likes.toLocaleString()} | </span>}
                          {lora["Last Modified"] && <span>Updated: {new Date(lora["Last Modified"]).toLocaleDateString()}</span>}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-0">
                      {lora.Description && (
                        <p className="text-xs text-muted-foreground max-h-10 overflow-y-auto" title={lora.Description}>
                          {lora.Description}
                        </p>
                      )}
                      {lora.Images && lora.Images.length > 0 ? (
                        <div className="flex space-x-2 overflow-x-auto pb-2 pt-1">
                          {lora.Images.slice(0, 5).map((image, index) => (
                            <img
                              key={index}
                              src={image.url}
                              alt={image.alt_text || `${lora.Name} sample ${index + 1}`}
                              className="h-28 w-auto object-contain rounded border p-0.5 hover:opacity-80 transition-opacity cursor-pointer"
                              title={image.alt_text || image.url}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No sample images available.</p>
                      )}
                    </CardContent>
                    <ItemCardFooter className="mt-auto pt-2">
                      <Button
                        variant={isSelectedOnGenerator ? "secondary" : "outline"}
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          if (!isSelectedOnGenerator && lora["Model Files"] && lora["Model Files"].length > 0) {
                            onAddLora(lora);
                          }
                        }}
                        disabled={isSelectedOnGenerator || !lora["Model Files"] || lora["Model Files"].length === 0}
                      >
                        {isSelectedOnGenerator ? "Added to Generator" : "Add to Generator"}
                      </Button>
                    </ItemCardFooter>
                  </div>
                </Card>
              );
            })
          ) : (
            <p className="text-center text-muted-foreground py-8">No LoRA models match your search criteria.</p>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <Pagination className="pt-4">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => { e.preventDefault(); if (page > 0) setPage(page - 1); }}
                    className={page === 0 ? 'pointer-events-none opacity-50' : ''}
                  />
                </PaginationItem>
                {Array.from({ length: totalPages }).map((_, idx) => (
                  <PaginationItem key={idx}>
                    <PaginationLink
                      href="#"
                      isActive={idx === page}
                      onClick={(e) => { e.preventDefault(); setPage(idx); }}
                    >
                      {idx + 1}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => { e.preventDefault(); if (page < totalPages - 1) setPage(page + 1); }}
                    className={page === totalPages - 1 ? 'pointer-events-none opacity-50' : ''}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      </ScrollArea>
    </div>
  )
};

interface MyLorasTabProps {
  myLorasResource: UseQueryResult<Resource[], Error>;
  onAddLora: (lora: LoraModel) => void;
  selectedLoraIds: string[];
  deleteResource: UseMutationResult<void, Error, { id: string; type: "lora"; }, unknown>;
  createResource: UseMutationResult<Resource, Error, { type: 'lora'; metadata: LoraModel; }, unknown>;
  lora_type: string;
}

const MyLorasTab: React.FC<MyLorasTabProps> = ({ myLorasResource, onAddLora, selectedLoraIds, deleteResource, createResource, lora_type }) => {
    const [addForm, setAddForm] = useState({ url: '', type: 'Flux.dev', name: '' });

    // Local Wan LoRAs (files dropped into Headless-Wan2GP/loras)
    const [localWanLoras, setLocalWanLoras] = useState<LoraModel[]>([]);

    useEffect(() => {
        // Only fetch for Wan type
        if (lora_type && lora_type.toLowerCase().includes('wan')) {
            fetch('/api/local-loras')
              .then(res => res.json())
              .then((data) => {
                  if (Array.isArray(data.files)) {
                      const parsed: LoraModel[] = data.files.map((filePath: string) => ({
                          "Model ID": filePath,
                          Name: filePath.split('/').pop() || filePath,
                          Author: 'Local',
                          Images: [],
                          "Model Files": [{ path: filePath, url: filePath }],
                          lora_type: 'Wan 2.1 14b',
                      }));
                      setLocalWanLoras(parsed);
                  }
              })
              .catch(err => console.error('Error fetching local LoRAs:', err));
        }
    }, [lora_type]);

    const handleAddLoraFromUrl = () => {
        // This is a placeholder. In a real implementation, you would fetch the URL,
        // parse the metadata, and then create the resource.
        console.log("Adding LoRA from URL:", addForm.url);
        // createResource.mutate({ type: 'lora', metadata: { ... } });
        alert("Adding from URL is not yet implemented.");
    };
    
    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Add a New LoRA</CardTitle>
                    <CardDescription>Add a LoRA from a URL or from your local files.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="lora-url">HuggingFace/CivitAI URL</Label>
                        <Input id="lora-url" placeholder="https://civitai.com/models/..." value={addForm.url} onChange={e => setAddForm({...addForm, url: e.target.value})} />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="lora-name">LoRA Name</Label>
                        <Input id="lora-name" placeholder="My Awesome LoRA" value={addForm.name} onChange={e => setAddForm({...addForm, name: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                        <Label>LoRA Type</Label>
                         <Select value={addForm.type} onValueChange={(value) => setAddForm({...addForm, type: value})}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select LoRA Type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Flux.dev">Flux.dev</SelectItem>
                                <SelectItem value="Wan 2.1 14b">Wan 2.1 14b</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
                <ItemCardFooter>
                    <Button onClick={handleAddLoraFromUrl}>Add LoRA</Button>
                </ItemCardFooter>
            </Card>
            
            <h3 className="text-lg font-semibold">Your Saved LoRAs</h3>
            
            {lora_type && lora_type.toLowerCase().includes('wan') && (
                <div className="p-4 bg-yellow-50 border border-yellow-300 rounded-md text-sm text-yellow-900 mb-4">
                    Drop your LoRAs in <code>Headless-Wan2GP/loras</code> to use them locally.
                </div>
            )}

            {myLorasResource.isLoading && <p>Loading your LoRAs...</p>}
            {myLorasResource.isError && <p className="text-red-500">Error loading your LoRAs.</p>}
            
            {myLorasResource.data && myLorasResource.data.length === 0 && (
                <div className="text-center text-muted-foreground py-8">
                    <p>You haven't added any LoRAs yet.</p>
                    <p>Explore the "Community LoRAs" tab to find and add models.</p>
                </div>
            )}

            {/* Local Wan LoRAs */}
            {lora_type && lora_type.toLowerCase().includes('wan') && localWanLoras.length > 0 && (
                <div className="pt-4">
                    <h4 className="text-md font-semibold mb-2">Local Wan LoRAs</h4>
                    <ScrollArea className="h-[300px] pr-4">
                        <div className="space-y-3 p-1">
                        {localWanLoras.map((lora) => {
                            const isSelectedOnGenerator = selectedLoraIds.includes(lora["Model ID"]);
                            return (
                                <Card key={lora["Model ID"]} className="w-full">
                                    <div className="flex flex-col">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-lg truncate" title={lora.Name}>{lora.Name}</CardTitle>
                                            <p className="text-xs text-muted-foreground">Local file</p>
                                        </CardHeader>
                                        <ItemCardFooter className="mt-auto pt-2">
                                            <Button
                                                variant={isSelectedOnGenerator ? "secondary" : "outline"}
                                                size="sm"
                                                className="w-full"
                                                onClick={() => onAddLora(lora)}
                                                disabled={isSelectedOnGenerator}
                                            >
                                                {isSelectedOnGenerator ? "Added" : "Add to Generator"}
                                            </Button>
                                        </ItemCardFooter>
                                    </div>
                                </Card>
                            );
                        })}
                        </div>
                    </ScrollArea>
                </div>
            )}

            {myLorasResource.data && myLorasResource.data.length > 0 && (
                <ScrollArea className="h-[400px] pr-4">
                    <div className="space-y-3 p-1">
                    {myLorasResource.data.map((resource: Resource) => {
                        const lora = resource.metadata;
                        const isSelectedOnGenerator = selectedLoraIds.includes(lora["Model ID"]);
                        return (
                            <Card key={resource.id} className="w-full">
                                <div className="flex flex-col">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-lg" title={lora.Name || lora["Model ID"]}>
                                            {lora.Name || lora["Model ID"]}
                                        </CardTitle>
                                        <p className="text-sm text-muted-foreground" title={lora.Author}>By: {lora.Author}</p>
                                    </CardHeader>
                                     <CardContent className="space-y-3 pt-0">
                                        {lora.Images && lora.Images.length > 0 && (
                                          <div className="flex space-x-2 overflow-x-auto pb-2 pt-1">
                                            {lora.Images.slice(0, 3).map((image, index) => (
                                              <img key={index} src={image.url} alt={image.alt_text} className="h-24 w-auto object-contain rounded border p-0.5"/>
                                            ))}
                                          </div>
                                        )}
                                    </CardContent>
                                    <ItemCardFooter className="mt-auto pt-2 flex justify-between">
                                        <Button
                                            variant={isSelectedOnGenerator ? "secondary" : "outline"}
                                            size="sm"
                                            onClick={() => onAddLora(lora)}
                                            disabled={isSelectedOnGenerator}
                                        >
                                            {isSelectedOnGenerator ? 'Added to Generator' : 'Add to Generator'}
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={() => deleteResource.mutate({ id: resource.id, type: 'lora' })}
                                            disabled={deleteResource.isPending}
                                        >
                                            Remove
                                        </Button>
                                    </ItemCardFooter>
                                </div>
                            </Card>
                        )
                    })}
                    </div>
                </ScrollArea>
            )}
        </div>
    );
};


export const LoraSelectorModal: React.FC<LoraSelectorModalProps> = ({
  isOpen,
  onClose,
  loras,
  onAddLora,
  selectedLoraIds,
  lora_type,
}) => {
  const modalStyle = usePaneAwareModalStyle();
  const myLorasResource = useListResources('lora');
  const createResource = useCreateResource();
  const deleteResource = useDeleteResource();

  if (!isOpen) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent style={modalStyle} className="max-w-4xl flex flex-col">
        <DialogHeader>
          <DialogTitle>Add LoRA Models</DialogTitle>
          <DialogDescription>
            Browse community LoRAs or manage your own collection.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="community" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="community">Community LoRAs</TabsTrigger>
                <TabsTrigger value="my-loras">My LoRAs</TabsTrigger>
            </TabsList>
            <TabsContent value="community">
                <CommunityLorasTab 
                    loras={loras} 
                    onAddLora={onAddLora} 
                    selectedLoraIds={selectedLoraIds} 
                    lora_type={lora_type}
                    myLorasResource={myLorasResource}
                    createResource={createResource}
                />
            </TabsContent>
            <TabsContent value="my-loras">
                <MyLorasTab 
                    myLorasResource={myLorasResource}
                    onAddLora={onAddLora}
                    selectedLoraIds={selectedLoraIds}
                    deleteResource={deleteResource}
                    createResource={createResource}
                    lora_type={lora_type}
                />
            </TabsContent>
        </Tabs>
        <DialogFooter className="pt-4">
          <Button onClick={onClose} variant="default">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}; 